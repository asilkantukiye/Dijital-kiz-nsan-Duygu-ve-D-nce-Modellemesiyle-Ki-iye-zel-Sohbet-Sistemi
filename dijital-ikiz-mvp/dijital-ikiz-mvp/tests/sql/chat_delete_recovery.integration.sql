\set ON_ERROR_STOP on

-- This test models a worker that has claimed a turn but has not yet committed
-- its model response. User-data deletion must invalidate that claim atomically.
RESET ROLE;

INSERT INTO public.messages (id, user_id, role, variant, content)
VALUES (
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee55',
  '55555555-5555-4555-8555-555555555555',
  'user',
  'personalized',
  'aud07-delete-recovery-source-message'
);

INSERT INTO public.twin_profiles (user_id, profile)
VALUES (
  '55555555-5555-4555-8555-555555555555',
  '{"valence":0.5,"arousal":0.5,"dominance":0.5}'::jsonb
);

INSERT INTO public.memory_items (user_id, memory_type, content, importance, embedding, source_message_id)
VALUES (
  '55555555-5555-4555-8555-555555555555',
  'preference',
  'aud07-delete-recovery-memory',
  0.5,
  ('[' || array_to_string((ARRAY[1::real] || array_fill(0::real, ARRAY[383])), ',') || ']')::extensions.vector(384),
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee55'
);

SET ROLE service_role;
DO $aud07_delete_invalidates_claim$
DECLARE
  claimed record;
  deletion_result jsonb;
  late_write_rejected boolean := false;
  actor uuid := '55555555-5555-4555-8555-555555555555';
  request_hash text := repeat('f', 64);
  owner_token uuid := 'ffffffff-ffff-4fff-8fff-ffffffffffff';
BEGIN
  SELECT * INTO claimed
  FROM public.claim_chat_request_server(actor, request_hash, owner_token);

  IF claimed.disposition <> 'claimed' THEN
    RAISE EXCEPTION 'AUD-07 failed: test request was not claimed';
  END IF;

  deletion_result := public.delete_my_chat_data_server(actor);

  IF (deletion_result ->> 'chat_claims_deleted')::integer <> 1 THEN
    RAISE EXCEPTION 'AUD-07 failed: deletion did not invalidate the pending claim';
  END IF;
  IF (deletion_result ->> 'memories_deleted')::integer <> 1
     OR (deletion_result ->> 'profiles_deleted')::integer <> 1
     OR (deletion_result ->> 'messages_deleted')::integer <> 1 THEN
    RAISE EXCEPTION 'AUD-07 failed: deletion counts did not include all fixture rows: %', deletion_result;
  END IF;

  BEGIN
    PERFORM * FROM public.persist_chat_turn_idempotent_server(
      actor,
      request_hash,
      owner_token,
      'baseline',
      'late user write',
      'late assistant write',
      '2026-10-26 20:00:00+00'::timestamptz,
      '2026-10-26 20:00:00.001+00'::timestamptz,
      NULL,
      jsonb_build_object('reply', 'late assistant write', 'profile', NULL, 'variant', 'baseline')
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'Chat request was not claimed' THEN RAISE; END IF;
    late_write_rejected := true;
  END;

  IF NOT late_write_rejected THEN
    RAISE EXCEPTION 'AUD-07 failed: an in-flight worker persisted after data deletion';
  END IF;

  IF has_function_privilege('authenticated', 'public.delete_my_chat_data_server(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.delete_my_chat_data_server(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.delete_my_chat_data_server(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'AUD-07 failed: server deletion RPC grants are not least-privilege';
  END IF;
END
$aud07_delete_invalidates_claim$;

RESET ROLE;

-- A late memory extractor can still be running after its chat turn committed.
-- Its authenticated RPC must re-check the source under the same per-user lock;
-- if deletion won the race, the now-missing source rejects the write.
SET ROLE authenticated;
SET request.jwt.claim.sub = '55555555-5555-4555-8555-555555555555';
DO $aud07_memory_write_after_delete$
DECLARE
  rejected boolean := false;
BEGIN
  BEGIN
    PERFORM public.persist_my_memory_item(
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee55'::uuid,
      'preference',
      'aud07-late-memory-after-delete',
      0.5,
      ('[' || array_to_string((ARRAY[1::real] || array_fill(0::real, ARRAY[383])), ',') || ']')::extensions.vector(384)
    );
  EXCEPTION WHEN foreign_key_violation THEN
    rejected := true;
  END;

  IF NOT rejected THEN
    RAISE EXCEPTION 'AUD-07 failed: memory was recreated after deletion removed its source message';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.memory_items
    WHERE user_id = '55555555-5555-4555-8555-555555555555'
      AND content = 'aud07-late-memory-after-delete'
  ) THEN
    RAISE EXCEPTION 'AUD-07 failed: stale memory row was persisted after deletion';
  END IF;
END
$aud07_memory_write_after_delete$;
RESET ROLE;

DO $aud07_delete_privileges$
BEGIN
  IF NOT has_table_privilege('service_role', 'public.memory_items', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.memory_items', 'DELETE')
     OR NOT has_table_privilege('service_role', 'public.twin_profiles', 'DELETE')
     OR NOT has_table_privilege('service_role', 'public.messages', 'DELETE') THEN
    RAISE EXCEPTION 'AUD-07 failed: server deletion is missing the minimum table privileges';
  END IF;
END
$aud07_delete_privileges$;

DO $aud07_delete_postconditions$
BEGIN
  IF EXISTS (SELECT 1 FROM public.chat_request_deduplication WHERE user_id = '55555555-5555-4555-8555-555555555555')
     OR EXISTS (SELECT 1 FROM public.memory_items WHERE user_id = '55555555-5555-4555-8555-555555555555')
     OR EXISTS (SELECT 1 FROM public.twin_profiles WHERE user_id = '55555555-5555-4555-8555-555555555555')
     OR EXISTS (SELECT 1 FROM public.messages WHERE user_id = '55555555-5555-4555-8555-555555555555') THEN
    RAISE EXCEPTION 'AUD-07 failed: deleted user data was recreated or left behind';
  END IF;

  IF has_function_privilege('authenticated', 'public.delete_my_chat_data()', 'EXECUTE') THEN
    RAISE EXCEPTION 'AUD-07 failed: legacy direct deletion RPC remains callable by authenticated users';
  END IF;
END
$aud07_delete_postconditions$;
