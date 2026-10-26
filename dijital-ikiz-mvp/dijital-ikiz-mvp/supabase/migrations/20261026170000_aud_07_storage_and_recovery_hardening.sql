-- AUD-07: strengthen storage invariants and serialize chat persistence against data deletion.
-- Lock order for server chat state is: per-user advisory lock -> idempotency row
-- -> profile row/messages. The lock is transaction-scoped; it is never held
-- while calling an external model provider.
BEGIN;

-- A memory source must be both owned by the same user and a user-authored message.
-- FK enforcement remains effective even if a client bypasses application validation.
CREATE UNIQUE INDEX IF NOT EXISTS messages_id_user_role_uidx
  ON public.messages (id, user_id, role);

ALTER TABLE public.memory_items
  ADD COLUMN IF NOT EXISTS source_message_role text NOT NULL DEFAULT 'user';

DO $memory_role_check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.memory_items'::regclass
      AND conname = 'memory_items_source_message_role_check'
  ) THEN
    ALTER TABLE public.memory_items
      ADD CONSTRAINT memory_items_source_message_role_check
      CHECK (source_message_role = 'user');
  END IF;
END
$memory_role_check$;

-- Detach any historical memory that points at a same-owner assistant message.
UPDATE public.memory_items AS memory
SET source_message_id = NULL
WHERE memory.source_message_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.messages AS source
    WHERE source.id = memory.source_message_id
      AND source.user_id = memory.user_id
      AND source.role = 'user'
  );

ALTER TABLE public.memory_items
  DROP CONSTRAINT IF EXISTS memory_items_source_message_id_fkey;
ALTER TABLE public.memory_items
  DROP CONSTRAINT IF EXISTS memory_items_source_message_owner_fkey;

ALTER TABLE public.memory_items
  ADD CONSTRAINT memory_items_source_message_owner_fkey
  FOREIGN KEY (source_message_id, user_id, source_message_role)
  REFERENCES public.messages (id, user_id, role)
  ON DELETE SET NULL (source_message_id);

-- Replace the two-column Stage-6 index with its three-column equivalent. This
-- preserves the same index name while covering the stricter source-role FK.
DROP INDEX IF EXISTS public.memory_items_source_message_owner_idx;
CREATE INDEX memory_items_source_message_owner_idx
  ON public.memory_items (source_message_id, user_id, source_message_role);

-- Normalize every new/replaced vector within PostgreSQL itself, before CHECKs
-- and HNSW index maintenance. Query-time cosine behavior is unchanged.
CREATE OR REPLACE FUNCTION public.normalize_memory_embedding()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  embedding_norm double precision;
BEGIN
  IF NEW.embedding IS NULL OR extensions.vector_dims(NEW.embedding) <> 384 THEN
    RAISE EXCEPTION 'Memory embedding must have exactly 384 dimensions'
      USING ERRCODE = '23514';
  END IF;

  embedding_norm := extensions.vector_norm(NEW.embedding);
  IF embedding_norm IS NULL
     OR NOT (embedding_norm > 0 AND embedding_norm < 'Infinity'::double precision) THEN
    RAISE EXCEPTION 'Memory embedding must have a finite, non-zero norm'
      USING ERRCODE = '23514';
  END IF;

  NEW.embedding := extensions.l2_normalize(NEW.embedding);
  embedding_norm := extensions.vector_norm(NEW.embedding);

  IF embedding_norm IS NULL
     OR NOT (embedding_norm > 0 AND embedding_norm < 'Infinity'::double precision)
     OR abs(embedding_norm - 1.0) > 0.001 THEN
    RAISE EXCEPTION 'Memory embedding normalization failed'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.normalize_memory_embedding() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.normalize_memory_embedding() TO service_role;

DROP TRIGGER IF EXISTS normalize_memory_embedding_before_insert ON public.memory_items;
CREATE TRIGGER normalize_memory_embedding_before_insert
  BEFORE INSERT ON public.memory_items
  FOR EACH ROW
  EXECUTE FUNCTION public.normalize_memory_embedding();

DROP TRIGGER IF EXISTS normalize_memory_embedding_before_update ON public.memory_items;
CREATE TRIGGER normalize_memory_embedding_before_update
  BEFORE UPDATE OF embedding ON public.memory_items
  FOR EACH ROW
  EXECUTE FUNCTION public.normalize_memory_embedding();

-- Backfill only rows outside the accepted unit-norm tolerance; non-finite and
-- zero vectors are already rejected by the existing validated integrity CHECK.
UPDATE public.memory_items
SET embedding = extensions.l2_normalize(embedding)
WHERE abs(extensions.vector_norm(embedding) - 1.0) > 0.001;

ALTER TABLE public.memory_items
  ADD CONSTRAINT memory_items_embedding_unit_norm_check
  CHECK (abs(extensions.vector_norm(embedding) - 1.0) <= 0.001)
  NOT VALID;
ALTER TABLE public.memory_items
  VALIDATE CONSTRAINT memory_items_embedding_unit_norm_check;

-- One lock order is shared by claim, release, persist, and deletion. Expired-row
-- cleanup uses SKIP LOCKED to prevent concurrent GC batches waiting on each other.
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
  
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Chat request identity is required';
  END IF;
  -- Stable per-user transaction lock establishes one lock order shared with
  -- persistence and data deletion. Hash collisions only over-serialize users.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 0));

  IF p_user_id IS NULL OR p_owner_token IS NULL THEN
    RAISE EXCEPTION 'Chat request identity is required';
  END IF;

  IF p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid chat request hash';
  END IF;

  -- Opportunistic bounded cleanup prevents old response payloads from accumulating.
  -- Expired message fingerprints are metadata only; chat messages are not deleted here.
  -- Opportunistic bounded cleanup must never wait for a row held by an active
  -- request. Stable tie-breakers make batch selection deterministic.
  WITH stale_claims AS (
    SELECT candidate.user_id, candidate.request_hash
    FROM public.chat_request_deduplication AS candidate
    WHERE (
      candidate.status IN ('completed', 'failed')
      AND candidate.dedupe_expires_at <= clock_timestamp()
    ) OR (
      candidate.status = 'processing'
      AND candidate.lease_expires_at < clock_timestamp() - interval '1 hour'
    )
    ORDER BY candidate.updated_at, candidate.user_id, candidate.request_hash
    LIMIT 100
    FOR UPDATE SKIP LOCKED
  )
  DELETE FROM public.chat_request_deduplication AS expired
  USING stale_claims
  WHERE expired.user_id = stale_claims.user_id
    AND expired.request_hash = stale_claims.request_hash;

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
  
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Chat request identity is required';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 0));

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
  v_profile_snapshot jsonb;
  v_response jsonb;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'Server-only idempotent chat writer'
      USING ERRCODE = '42501';
  END IF;
  
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Chat request identity is required';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 0));

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

    IF (SELECT count(*) FROM jsonb_object_keys(p_profile_snapshot)) <> 13
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

-- This RPC invalidates in-flight claims before deleting chat rows, so a delayed
-- model response cannot recreate records after the user has requested deletion.
CREATE OR REPLACE FUNCTION public.delete_my_chat_data_server(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  deleted_memories integer := 0;
  deleted_profiles integer := 0;
  deleted_messages integer := 0;
  deleted_claims integer := 0;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'Server-only user-data deletion'
      USING ERRCODE = '42501';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'User identity is required';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 0));

  DELETE FROM public.chat_request_deduplication WHERE user_id = p_user_id;
  GET DIAGNOSTICS deleted_claims = ROW_COUNT;

  DELETE FROM public.memory_items WHERE user_id = p_user_id;
  GET DIAGNOSTICS deleted_memories = ROW_COUNT;

  DELETE FROM public.twin_profiles WHERE user_id = p_user_id;
  GET DIAGNOSTICS deleted_profiles = ROW_COUNT;

  DELETE FROM public.messages WHERE user_id = p_user_id;
  GET DIAGNOSTICS deleted_messages = ROW_COUNT;

  RETURN jsonb_build_object(
    'memories_deleted', deleted_memories,
    'profiles_deleted', deleted_profiles,
    'messages_deleted', deleted_messages,
    'chat_claims_deleted', deleted_claims
  );
END;
$$;

-- Privileges on DELETE are not inherited from BYPASSRLS; grant only the server role.
GRANT SELECT, DELETE ON TABLE public.memory_items TO service_role;
GRANT DELETE ON TABLE public.twin_profiles, public.messages TO service_role;
REVOKE ALL ON FUNCTION public.delete_my_chat_data() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_my_chat_data_server(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_my_chat_data_server(uuid) TO service_role;

COMMIT;
