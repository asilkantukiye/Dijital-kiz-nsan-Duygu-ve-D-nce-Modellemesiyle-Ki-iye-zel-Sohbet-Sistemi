-- Serialize user-data deletion against in-flight chat claims and late model completions.
-- A per-user generation is read before claim and checked under a row lock during claim.
-- Deletion increments it and removes all outstanding claims in the same transaction.

BEGIN;

CREATE TABLE IF NOT EXISTS public.chat_user_data_generations (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  generation integer NOT NULL DEFAULT 0 CHECK (generation >= 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE public.chat_user_data_generations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.chat_user_data_generations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.chat_user_data_generations TO service_role;
GRANT USAGE ON SCHEMA public TO service_role;

-- A DB-side RLS guard also protects writes from an older Vercel instance during
-- deployment. The generation function locks the same row used by the delete RPC.
ALTER TABLE public.memory_items
  ADD COLUMN IF NOT EXISTS data_generation integer NOT NULL DEFAULT 0
  CHECK (data_generation >= 0);

CREATE OR REPLACE FUNCTION public.current_my_chat_data_generation()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_generation integer;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.chat_user_data_generations (user_id, generation)
  VALUES (v_user_id, 0)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT generation
  INTO v_generation
  FROM public.chat_user_data_generations
  WHERE user_id = v_user_id
  FOR SHARE;

  IF v_generation IS NULL THEN
    RAISE EXCEPTION 'Chat generation record is unavailable';
  END IF;

  RETURN v_generation;
END;
$$;

REVOKE ALL ON FUNCTION public.current_my_chat_data_generation() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.current_my_chat_data_generation() TO authenticated;

DROP POLICY IF EXISTS "users own memory items" ON public.memory_items;
CREATE POLICY "users own memory items"
  ON public.memory_items
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND data_generation = public.current_my_chat_data_generation()
  );

ALTER TABLE public.chat_request_deduplication
  ADD COLUMN IF NOT EXISTS generation integer NOT NULL DEFAULT 0
  CHECK (generation >= 0);

CREATE OR REPLACE FUNCTION public.get_chat_data_generation_server(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_generation integer;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'Server-only chat generation lookup'
      USING ERRCODE = '42501';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Chat user identity is required';
  END IF;

  INSERT INTO public.chat_user_data_generations (user_id, generation)
  VALUES (p_user_id, 0)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT generation
  INTO v_generation
  FROM public.chat_user_data_generations
  WHERE user_id = p_user_id;

  IF v_generation IS NULL THEN
    RAISE EXCEPTION 'Chat generation record is unavailable';
  END IF;

  RETURN v_generation;
END;
$$;

REVOKE ALL ON FUNCTION public.get_chat_data_generation_server(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_chat_data_generation_server(uuid) TO service_role;

-- Memory writes happen after the model response is committed and therefore need
-- the same generation lock. This narrowly scoped definer RPC uses auth.uid()
-- instead of accepting a user ID, and writes only to that user's memory rows.
CREATE OR REPLACE FUNCTION public.persist_my_memory_at_generation(
  p_generation integer,
  p_memory_type text,
  p_content text,
  p_importance real,
  p_embedding extensions.vector,
  p_source_message_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_generation integer;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_generation IS NULL OR p_generation < 0 THEN
    RAISE EXCEPTION 'Invalid chat data generation';
  END IF;

  IF p_memory_type IS NULL OR p_memory_type NOT IN ('preference', 'communication') THEN
    RAISE EXCEPTION 'Invalid memory type';
  END IF;

  IF p_content IS NULL OR char_length(btrim(p_content)) NOT BETWEEN 2 AND 240 THEN
    RAISE EXCEPTION 'Invalid memory content';
  END IF;

  IF p_importance IS NULL OR p_importance NOT BETWEEN 0 AND 1 THEN
    RAISE EXCEPTION 'Invalid memory importance';
  END IF;

  IF p_embedding IS NULL
     OR extensions.vector_dims(p_embedding) <> 384
     OR extensions.vector_norm(p_embedding) <= 0
     OR extensions.vector_norm(p_embedding) >= 'Infinity'::real THEN
    RAISE EXCEPTION 'Invalid memory embedding';
  END IF;

  SELECT generation
  INTO v_generation
  FROM public.chat_user_data_generations
  WHERE user_id = v_user_id
  FOR SHARE;

  IF v_generation IS NULL OR v_generation <> p_generation THEN
    RAISE EXCEPTION 'Memory write invalidated by data deletion'
      USING ERRCODE = 'P0409';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.messages
    WHERE id = p_source_message_id
      AND user_id = v_user_id
      AND role = 'user'
  ) THEN
    RAISE EXCEPTION 'Memory source message is not owned by the caller';
  END IF;

  INSERT INTO public.memory_items (
    user_id, memory_type, content, importance, embedding,
    source_message_id, updated_at, data_generation
  )
  VALUES (
    v_user_id, p_memory_type, btrim(p_content), p_importance, p_embedding,
    p_source_message_id, clock_timestamp(), p_generation
  )
  ON CONFLICT (user_id, content) DO UPDATE
    SET memory_type = EXCLUDED.memory_type,
        importance = EXCLUDED.importance,
        embedding = EXCLUDED.embedding,
        source_message_id = EXCLUDED.source_message_id,
        updated_at = EXCLUDED.updated_at,
        data_generation = EXCLUDED.data_generation;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.persist_my_memory_at_generation(
  integer, text, text, real, extensions.vector, uuid
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.persist_my_memory_at_generation(
  integer, text, text, real, extensions.vector, uuid
) TO authenticated;

-- Replace the original three-argument function with a backward-compatible
-- fourth parameter that defaults to NULL. Older SQL callers can still use
-- three arguments; the web route supplies the generation it observed.
DROP FUNCTION public.claim_chat_request_server(uuid, text, uuid);

CREATE FUNCTION public.claim_chat_request_server(
  p_user_id uuid,
  p_request_hash text,
  p_owner_token uuid,
  p_generation integer DEFAULT NULL
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
  v_current_generation integer;
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

  INSERT INTO public.chat_user_data_generations (user_id, generation)
  VALUES (p_user_id, 0)
  ON CONFLICT (user_id) DO NOTHING;

  -- Hold a shared row lock until this claim transaction ends. User-data
  -- deletion updates this row, so claim and deletion receive a serial order.
  SELECT generation
  INTO v_current_generation
  FROM public.chat_user_data_generations
  WHERE user_id = p_user_id
  FOR SHARE;

  IF v_current_generation IS NULL THEN
    RAISE EXCEPTION 'Chat generation record is unavailable';
  END IF;

  IF p_generation IS NOT NULL AND p_generation <> v_current_generation THEN
    RAISE EXCEPTION 'Chat request invalidated by data deletion'
      USING ERRCODE = 'P0409';
  END IF;

  -- Opportunistic bounded cleanup prevents old response payloads accumulating.
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
    user_id, request_hash, generation, status, owner_token, lease_expires_at,
    dedupe_expires_at, created_at, updated_at
  )
  VALUES (
    p_user_id, p_request_hash, v_current_generation, 'processing', p_owner_token,
    clock_timestamp() + interval '5 minutes',
    clock_timestamp() + interval '5 minutes',
    clock_timestamp(), clock_timestamp()
  )
  ON CONFLICT (user_id, request_hash) DO UPDATE
    SET generation = EXCLUDED.generation,
        status = 'processing',
        owner_token = EXCLUDED.owner_token,
        response = NULL,
        user_message_id = NULL,
        assistant_message_id = NULL,
        lease_expires_at = EXCLUDED.lease_expires_at,
        dedupe_expires_at = EXCLUDED.dedupe_expires_at,
        created_at = clock_timestamp(),
        updated_at = clock_timestamp()
    WHERE public.chat_request_deduplication.generation <> v_current_generation
       OR public.chat_request_deduplication.status = 'failed'
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

  IF v_existing.generation <> v_current_generation THEN
    RAISE EXCEPTION 'Chat request invalidated by data deletion'
      USING ERRCODE = 'P0409';
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

REVOKE ALL ON FUNCTION public.claim_chat_request_server(uuid, text, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_chat_request_server(uuid, text, uuid, integer) TO service_role;

-- No user-supplied IDs: the privileged helper can invalidate claims only for
-- the identity authenticated by Supabase Auth. The generation row is retained
-- after chat-data deletion so an old in-flight request cannot see the epoch reset.
CREATE OR REPLACE FUNCTION public.delete_my_chat_request_claims_for_current_user()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_deleted integer := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  INSERT INTO public.chat_user_data_generations (user_id, generation)
  VALUES (v_user_id, 0)
  ON CONFLICT (user_id) DO NOTHING;

  UPDATE public.chat_user_data_generations
  SET generation = generation + 1,
      updated_at = clock_timestamp()
  WHERE user_id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Chat generation record is unavailable';
  END IF;

  DELETE FROM public.chat_request_deduplication
  WHERE user_id = v_user_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_my_chat_request_claims_for_current_user() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_my_chat_request_claims_for_current_user() TO authenticated;

-- Keep deletion atomic. If any user-data deletion fails, the generation bump
-- and claim removal roll back along with messages, profile, and memories.
CREATE OR REPLACE FUNCTION public.delete_my_chat_data()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  deleted_memories integer := 0;
  deleted_profiles integer := 0;
  deleted_messages integer := 0;
  deleted_claims integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  deleted_claims := public.delete_my_chat_request_claims_for_current_user();

  DELETE FROM public.memory_items
  WHERE user_id = (SELECT auth.uid());
  GET DIAGNOSTICS deleted_memories = ROW_COUNT;

  DELETE FROM public.twin_profiles
  WHERE user_id = (SELECT auth.uid());
  GET DIAGNOSTICS deleted_profiles = ROW_COUNT;

  -- message_feedback rows cascade from messages.
  DELETE FROM public.messages
  WHERE user_id = (SELECT auth.uid());
  GET DIAGNOSTICS deleted_messages = ROW_COUNT;

  RETURN jsonb_build_object(
    'memories_deleted', deleted_memories,
    'profiles_deleted', deleted_profiles,
    'messages_deleted', deleted_messages,
    'dedupe_rows_deleted', deleted_claims
  );
END;
$$;

COMMIT;
