-- AUD-02: deduplicate same-user, same-variant, same-prompt chat requests.
-- Only a short-lived SHA-256 fingerprint is stored; the prompt itself is not copied
-- into this table. Claiming is an atomic INSERT/ON CONFLICT operation.
CREATE TABLE public.chat_request_deduplication (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'completed', 'failed')),
  owner_token uuid,
  response jsonb,
  user_message_id uuid REFERENCES public.messages(id) ON DELETE CASCADE,
  assistant_message_id uuid REFERENCES public.messages(id) ON DELETE CASCADE,
  lease_expires_at timestamptz,
  dedupe_expires_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (user_id, request_hash),
  CHECK (
    (status = 'processing' AND owner_token IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (status <> 'processing' AND owner_token IS NULL AND lease_expires_at IS NULL)
  ),
  CHECK (
    status <> 'completed'
    OR (
      response IS NOT NULL
      AND user_message_id IS NOT NULL
      AND assistant_message_id IS NOT NULL
    )
  )
);

ALTER TABLE public.chat_request_deduplication ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.chat_request_deduplication FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.chat_request_deduplication TO service_role;
GRANT USAGE ON SCHEMA public TO service_role;

CREATE INDEX chat_request_deduplication_expiry_idx
  ON public.chat_request_deduplication (dedupe_expires_at, updated_at);

CREATE OR REPLACE FUNCTION public.claim_chat_request_server(
  p_user_id uuid,
  p_request_hash text,
  p_owner_token uuid
)
RETURNS TABLE (
  disposition text,
  response jsonb,
  lease_expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_claimed_owner uuid;
  v_claimed_lease timestamptz;
  v_existing public.chat_request_deduplication%ROWTYPE;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'Server-only chat idempotency claim'
      USING ERRCODE = '42501';
  END IF;

  IF p_user_id IS NULL OR p_owner_token IS NULL THEN
    RAISE EXCEPTION 'Chat request identity is required';
  END IF;

  IF p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid chat request hash';
  END IF;

  -- Opportunistic bounded cleanup prevents old response payloads from accumulating.
  -- Expired message fingerprints are metadata only; chat messages are not deleted here.
  DELETE FROM public.chat_request_deduplication AS expired
  WHERE expired.ctid IN (
    SELECT candidate.ctid
    FROM public.chat_request_deduplication AS candidate
    WHERE (
      candidate.status IN ('completed', 'failed')
      AND candidate.dedupe_expires_at <= clock_timestamp()
    ) OR (
      candidate.status = 'processing'
      AND candidate.lease_expires_at < clock_timestamp() - interval '1 hour'
    )
    ORDER BY candidate.updated_at
    LIMIT 100
  );

  INSERT INTO public.chat_request_deduplication (
    user_id, request_hash, status, owner_token, lease_expires_at,
    dedupe_expires_at, created_at, updated_at
  )
  VALUES (
    p_user_id, p_request_hash, 'processing', p_owner_token,
    clock_timestamp() + interval '5 minutes',
    clock_timestamp() + interval '5 minutes',
    clock_timestamp(), clock_timestamp()
  )
  ON CONFLICT (user_id, request_hash) DO UPDATE
    SET status = 'processing',
        owner_token = EXCLUDED.owner_token,
        response = NULL,
        user_message_id = NULL,
        assistant_message_id = NULL,
        lease_expires_at = EXCLUDED.lease_expires_at,
        dedupe_expires_at = EXCLUDED.dedupe_expires_at,
        created_at = clock_timestamp(),
        updated_at = clock_timestamp()
    WHERE public.chat_request_deduplication.status = 'failed'
       OR (
         public.chat_request_deduplication.status = 'processing'
         AND public.chat_request_deduplication.lease_expires_at <= clock_timestamp()
       )
       OR (
         public.chat_request_deduplication.status = 'completed'
         AND public.chat_request_deduplication.dedupe_expires_at <= clock_timestamp()
       )
  RETURNING owner_token, public.chat_request_deduplication.lease_expires_at
  INTO v_claimed_owner, v_claimed_lease;

  IF FOUND THEN
    RETURN QUERY SELECT 'claimed'::text, NULL::jsonb, v_claimed_lease;
    RETURN;
  END IF;

  SELECT *
  INTO v_existing
  FROM public.chat_request_deduplication
  WHERE user_id = p_user_id
    AND request_hash = p_request_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Chat request claim disappeared'
      USING ERRCODE = '40001';
  END IF;

  IF v_existing.status = 'completed'
     AND v_existing.dedupe_expires_at > clock_timestamp() THEN
    RETURN QUERY SELECT 'replay'::text, v_existing.response, v_existing.lease_expires_at;
    RETURN;
  END IF;

  IF v_existing.status = 'processing'
     AND v_existing.lease_expires_at > clock_timestamp() THEN
    RETURN QUERY SELECT 'in_progress'::text, NULL::jsonb, v_existing.lease_expires_at;
    RETURN;
  END IF;

  RAISE EXCEPTION 'Chat request claim must be retried'
    USING ERRCODE = '40001';
END;
$$;

CREATE OR REPLACE FUNCTION public.release_chat_request_server(
  p_user_id uuid,
  p_request_hash text,
  p_owner_token uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'Server-only chat idempotency release'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.chat_request_deduplication
  SET status = 'failed',
      owner_token = NULL,
      response = NULL,
      user_message_id = NULL,
      assistant_message_id = NULL,
      lease_expires_at = NULL,
      dedupe_expires_at = clock_timestamp(),
      updated_at = clock_timestamp()
  WHERE user_id = p_user_id
    AND request_hash = p_request_hash
    AND status = 'processing'
    AND owner_token = p_owner_token;
END;
$$;

CREATE OR REPLACE FUNCTION public.persist_chat_turn_idempotent_server(
  p_user_id uuid,
  p_request_hash text,
  p_owner_token uuid,
  p_variant text,
  p_user_content text,
  p_assistant_content text,
  p_user_created_at timestamptz,
  p_assistant_created_at timestamptz,
  p_profile_snapshot jsonb,
  p_response_payload jsonb
)
RETURNS TABLE (
  user_message_id uuid,
  assistant_message_id uuid,
  response jsonb,
  disposition text
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_claim public.chat_request_deduplication%ROWTYPE;
  v_user_message_id uuid;
  v_assistant_message_id uuid;
  v_response jsonb;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'Server-only idempotent chat writer'
      USING ERRCODE = '42501';
  END IF;

  IF p_user_id IS NULL OR p_owner_token IS NULL THEN
    RAISE EXCEPTION 'Chat request identity is required';
  END IF;

  IF p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid chat request hash';
  END IF;

  SELECT *
  INTO v_claim
  FROM public.chat_request_deduplication
  WHERE user_id = p_user_id
    AND request_hash = p_request_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Chat request was not claimed';
  END IF;

  -- A late duplicate completion can read the committed result, but cannot write
  -- another profile/message pair.
  IF v_claim.status = 'completed' THEN
    RETURN QUERY SELECT
      v_claim.user_message_id,
      v_claim.assistant_message_id,
      v_claim.response,
      'replay'::text;
    RETURN;
  END IF;

  IF v_claim.status <> 'processing'
     OR v_claim.owner_token IS DISTINCT FROM p_owner_token THEN
    RAISE EXCEPTION 'Chat request claim is not owned by this worker'
      USING ERRCODE = '40001';
  END IF;

  IF p_variant IS NULL OR p_variant NOT IN ('personalized', 'baseline') THEN
    RAISE EXCEPTION 'Invalid chat variant';
  END IF;

  IF p_user_content IS NULL OR char_length(p_user_content) NOT BETWEEN 1 AND 4000 THEN
    RAISE EXCEPTION 'Invalid user message';
  END IF;

  IF p_assistant_content IS NULL OR char_length(p_assistant_content) NOT BETWEEN 1 AND 4000 THEN
    RAISE EXCEPTION 'Invalid assistant message';
  END IF;

  IF p_user_created_at IS NULL
     OR p_assistant_created_at IS NULL
     OR p_assistant_created_at <= p_user_created_at THEN
    RAISE EXCEPTION 'Invalid chat timestamps';
  END IF;

  IF jsonb_typeof(p_response_payload) IS DISTINCT FROM 'object'
     OR COALESCE(p_response_payload ->> 'reply', '') = ''
     OR p_response_payload ->> 'variant' IS DISTINCT FROM p_variant THEN
    RAISE EXCEPTION 'Invalid cached chat response';
  END IF;

  IF p_variant = 'personalized' THEN
    IF p_profile_snapshot IS NULL
       OR jsonb_typeof(p_profile_snapshot) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'Personalized chat requires an object profile';
    END IF;

    INSERT INTO public.twin_profiles (user_id, profile, updated_at)
    VALUES (p_user_id, p_profile_snapshot, p_assistant_created_at)
    ON CONFLICT (user_id) DO UPDATE
      SET profile = EXCLUDED.profile,
          updated_at = EXCLUDED.updated_at;
  ELSIF p_profile_snapshot IS NOT NULL THEN
    RAISE EXCEPTION 'Baseline chat cannot persist a profile snapshot';
  END IF;

  INSERT INTO public.messages (
    user_id, role, variant, content, profile_snapshot, created_at
  )
  VALUES (
    p_user_id, 'user', p_variant, p_user_content, p_profile_snapshot, p_user_created_at
  )
  RETURNING id INTO v_user_message_id;

  INSERT INTO public.messages (
    user_id, role, variant, content, profile_snapshot, created_at
  )
  VALUES (
    p_user_id, 'assistant', p_variant, p_assistant_content, p_profile_snapshot, p_assistant_created_at
  )
  RETURNING id INTO v_assistant_message_id;

  v_response := p_response_payload || jsonb_build_object('messageId', v_assistant_message_id::text);

  UPDATE public.chat_request_deduplication
  SET status = 'completed',
      owner_token = NULL,
      response = v_response,
      user_message_id = v_user_message_id,
      assistant_message_id = v_assistant_message_id,
      lease_expires_at = NULL,
      dedupe_expires_at = clock_timestamp() + interval '10 seconds',
      updated_at = clock_timestamp()
  WHERE user_id = p_user_id
    AND request_hash = p_request_hash
    AND status = 'processing'
    AND owner_token = p_owner_token;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Chat request ownership changed during persistence'
      USING ERRCODE = '40001';
  END IF;

  RETURN QUERY SELECT
    v_user_message_id,
    v_assistant_message_id,
    v_response,
    'completed'::text;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_chat_request_server(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_chat_request_server(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.persist_chat_turn_idempotent_server(
  uuid, text, uuid, text, text, text, timestamptz, timestamptz, jsonb, jsonb
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_chat_request_server(uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_chat_request_server(uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.persist_chat_turn_idempotent_server(
  uuid, text, uuid, text, text, text, timestamptz, timestamptz, jsonb, jsonb
) TO service_role;
