-- AUD-03: merge each message's profile observation with the latest committed profile.
-- The upsert's conflicting-row lock serializes writes, preventing stale snapshots from
-- replacing trait updates produced by concurrent, different chat requests.

CREATE OR REPLACE FUNCTION public.merge_twin_profile_observation(
  p_current jsonb,
  p_observation jsonb
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE(
    jsonb_object_agg(
      incoming.key,
      to_jsonb(
        CASE
          WHEN jsonb_typeof(p_current -> incoming.key) = 'number' THEN
            GREATEST(
              0::numeric,
              LEAST(
                1::numeric,
                (p_current ->> incoming.key)::numeric * 0.75
                  + (incoming.value #>> '{}')::numeric * 0.25
              )
            )
          ELSE (incoming.value #>> '{}')::numeric
        END
      )
    ),
    '{}'::jsonb
  )
  FROM jsonb_each(p_observation) AS incoming(key, value);
$$;

REVOKE ALL ON FUNCTION public.merge_twin_profile_observation(jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_twin_profile_observation(jsonb, jsonb)
  TO service_role;

-- Preserve the AUD-02 function signature so existing server callers keep working.
-- p_profile_snapshot now carries a validated per-message observation, not a stale
-- complete snapshot. The value returned by the atomic UPSERT is the canonical state.
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
  v_profile_snapshot jsonb;
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
      RAISE EXCEPTION 'Personalized chat requires a profile observation';
    END IF;

    IF jsonb_object_length(p_profile_snapshot) <> 13
       OR EXISTS (
         SELECT 1
         FROM jsonb_each(p_profile_snapshot) AS item(key, value)
         WHERE NOT (item.key = ANY (ARRAY[
           'valence', 'arousal', 'dominance', 'openness',
           'conscientiousness', 'extraversion', 'agreeableness',
           'neuroticism', 'informality', 'emoji_frequency',
           'humor', 'slang', 'avg_sentence_length'
         ]::text[]))
         OR NOT (
           CASE
             WHEN jsonb_typeof(item.value) = 'number'
               THEN (item.value #>> '{}')::numeric BETWEEN 0 AND 1
             ELSE false
           END
         )
       ) THEN
      RAISE EXCEPTION 'Invalid profile observation payload';
    END IF;

    -- PostgreSQL serializes concurrent inserts/updates on the unique user_id row.
    -- Crucially, the UPDATE combines EXCLUDED observation with the locked row instead
    -- of assigning EXCLUDED.profile directly, so concurrent traits cannot be lost.
    INSERT INTO public.twin_profiles (user_id, profile, updated_at)
    VALUES (p_user_id, p_profile_snapshot, clock_timestamp())
    ON CONFLICT (user_id) DO UPDATE
      SET profile = public.merge_twin_profile_observation(
            twin_profiles.profile,
            EXCLUDED.profile
          ),
          updated_at = clock_timestamp()
    RETURNING profile INTO v_profile_snapshot;
  ELSIF p_profile_snapshot IS NOT NULL THEN
    RAISE EXCEPTION 'Baseline chat cannot persist a profile observation';
  END IF;

  INSERT INTO public.messages (
    user_id, role, variant, content, profile_snapshot, created_at
  )
  VALUES (
    p_user_id, 'user', p_variant, p_user_content, v_profile_snapshot, p_user_created_at
  )
  RETURNING id INTO v_user_message_id;

  INSERT INTO public.messages (
    user_id, role, variant, content, profile_snapshot, created_at
  )
  VALUES (
    p_user_id, 'assistant', p_variant, p_assistant_content, v_profile_snapshot, p_assistant_created_at
  )
  RETURNING id INTO v_assistant_message_id;

  -- The returned profile, both message snapshots, and the replay cache share one
  -- transaction and therefore cannot expose divergent states after a rollback.
  v_response := p_response_payload || jsonb_build_object(
    'profile',
    CASE WHEN p_variant = 'personalized' THEN v_profile_snapshot ELSE NULL END,
    'messageId',
    v_assistant_message_id::text
  );

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

REVOKE ALL ON FUNCTION public.persist_chat_turn_idempotent_server(
  uuid, text, uuid, text, text, text, timestamptz, timestamptz, jsonb, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.persist_chat_turn_idempotent_server(
  uuid, text, uuid, text, text, text, timestamptz, timestamptz, jsonb, jsonb
) TO service_role;
