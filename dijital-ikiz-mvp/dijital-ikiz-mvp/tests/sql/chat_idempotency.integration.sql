\set ON_ERROR_STOP on

-- This runs after AUD-02 migration under PostgreSQL/pgvector CI.
RESET ROLE;
SET ROLE service_role;

DO $idempotency_claim$
DECLARE
  first_claim record;
  second_claim record;
BEGIN
  SELECT * INTO first_claim
  FROM public.claim_chat_request_server(
    '44444444-4444-4444-8444-444444444444'::uuid,
    repeat('a', 64),
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid
  );

  IF first_claim.disposition <> 'claimed' THEN
    RAISE EXCEPTION 'first identical request was not claimed';
  END IF;

  SELECT * INTO second_claim
  FROM public.claim_chat_request_server(
    '44444444-4444-4444-8444-444444444444'::uuid,
    repeat('a', 64),
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid
  );

  IF second_claim.disposition <> 'in_progress' THEN
    RAISE EXCEPTION 'second identical claim did not return in_progress';
  END IF;

  IF second_claim.response IS NOT NULL THEN
    RAISE EXCEPTION 'in-progress claim unexpectedly exposed an unfinished response';
  END IF;

  -- Fingerprints are scoped by user; a second account gets its own claim.
  SELECT * INTO second_claim
  FROM public.claim_chat_request_server(
    '22222222-2222-4222-8222-222222222222'::uuid,
    repeat('a', 64),
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid
  );

  IF second_claim.disposition <> 'claimed' THEN
    RAISE EXCEPTION 'request fingerprint leaked across user accounts';
  END IF;

  PERFORM public.release_chat_request_server(
    '22222222-2222-4222-8222-222222222222'::uuid,
    repeat('a', 64),
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid
  );
END
$idempotency_claim$;

-- The response payload and exactly two messages commit in the same SQL RPC.
DO $idempotency_persist$
DECLARE
  stored record;
  replay record;
BEGIN
  SELECT * INTO stored
  FROM public.persist_chat_turn_idempotent_server(
    '44444444-4444-4444-8444-444444444444'::uuid,
    repeat('a', 64),
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
    'baseline',
    'identical user request',
    'single generated reply',
    '2026-10-23 20:00:00+00'::timestamptz,
    '2026-10-23 20:00:00.001+00'::timestamptz,
    NULL,
    jsonb_build_object('reply', 'single generated reply', 'profile', NULL, 'variant', 'baseline')
  );

  IF stored.disposition <> 'completed' THEN
    RAISE EXCEPTION 'first request did not complete persistence';
  END IF;

  IF stored.response ->> 'messageId' IS DISTINCT FROM stored.assistant_message_id::text THEN
    RAISE EXCEPTION 'cached response messageId does not match the persisted assistant row';
  END IF;

  IF (SELECT count(*) FROM public.messages WHERE user_id = '44444444-4444-4444-8444-444444444444') <> 2 THEN
    RAISE EXCEPTION 'one successful chat turn must persist exactly two message rows';
  END IF;

  SELECT * INTO replay
  FROM public.claim_chat_request_server(
    '44444444-4444-4444-8444-444444444444'::uuid,
    repeat('a', 64),
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid
  );

  IF replay.disposition <> 'replay' THEN
    RAISE EXCEPTION 'completed request did not return the cached response';
  END IF;

  IF replay.response IS DISTINCT FROM stored.response THEN
    RAISE EXCEPTION 'retry response does not match the original response';
  END IF;

  IF (SELECT count(*) FROM public.messages WHERE user_id = '44444444-4444-4444-8444-444444444444') <> 2 THEN
    RAISE EXCEPTION 'replay inserted a duplicate user/assistant message pair';
  END IF;
END
$idempotency_persist$;

-- A failed second message insert rolls back the profile/messages/cache together.
DO $idempotency_rollback$
DECLARE
  failed_as_expected boolean := false;
  v_request_hash text := repeat('b', 64);
  owner_token uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'::uuid;
  actor uuid := '33333333-3333-4333-8333-333333333333'::uuid;
BEGIN
  PERFORM * FROM public.claim_chat_request_server(actor, v_request_hash, owner_token);

  BEGIN
    PERFORM * FROM public.persist_chat_turn_idempotent_server(
      actor,
      v_request_hash,
      owner_token,
      'personalized',
      'this request must roll back',
      'simulate-second-write-failure',
      '2026-10-23 20:01:00+00'::timestamptz,
      '2026-10-23 20:01:00.001+00'::timestamptz,
      '{"valence":0.5,"arousal":0.5,"dominance":0.5,"openness":0.5,"conscientiousness":0.5,"extraversion":0.5,"agreeableness":0.5,"neuroticism":0.5,"informality":0.5,"emoji_frequency":0.5,"humor":0.5,"slang":0.5,"avg_sentence_length":0.5}'::jsonb,
      jsonb_build_object('reply', 'simulate-second-write-failure', 'profile', '{"valence":0.5,"arousal":0.5,"dominance":0.5,"openness":0.5,"conscientiousness":0.5,"extraversion":0.5,"agreeableness":0.5,"neuroticism":0.5,"informality":0.5,"emoji_frequency":0.5,"humor":0.5,"slang":0.5,"avg_sentence_length":0.5}'::jsonb, 'variant', 'personalized')
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'simulated assistant insert failure' THEN RAISE; END IF;
    failed_as_expected := true;
  END;

  IF NOT failed_as_expected THEN
    RAISE EXCEPTION 'simulated second-message failure did not occur';
  END IF;

  IF EXISTS (SELECT 1 FROM public.messages WHERE user_id = actor) THEN
    RAISE EXCEPTION 'failed idempotent turn left message rows';
  END IF;

  IF EXISTS (SELECT 1 FROM public.twin_profiles WHERE user_id = actor) THEN
    RAISE EXCEPTION 'failed idempotent turn left a profile update';
  END IF;

  IF (SELECT status FROM public.chat_request_deduplication WHERE user_id = actor AND chat_request_deduplication.request_hash = v_request_hash) <> 'processing' THEN
    RAISE EXCEPTION 'failed transaction unexpectedly committed idempotency completion';
  END IF;

  PERFORM public.release_chat_request_server(actor, v_request_hash, owner_token);

  IF (SELECT status FROM public.chat_request_deduplication WHERE user_id = actor AND chat_request_deduplication.request_hash = v_request_hash) <> 'failed' THEN
    RAISE EXCEPTION 'failed owner did not release its idempotency claim';
  END IF;
END
$idempotency_rollback$;

-- Browser JWTs cannot call claim/release/persist or inspect the idempotency table.
RESET ROLE;
DO $idempotency_acl$
BEGIN
  IF has_table_privilege('anon', 'public.chat_request_deduplication', 'SELECT')
     OR has_table_privilege('authenticated', 'public.chat_request_deduplication', 'SELECT') THEN
    RAISE EXCEPTION 'browser roles can read idempotency response cache';
  END IF;

  IF has_function_privilege('anon', 'public.claim_chat_request_server(uuid,text,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.claim_chat_request_server(uuid,text,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.release_chat_request_server(uuid,text,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.release_chat_request_server(uuid,text,uuid)', 'EXECUTE')
     OR has_function_privilege(
       'authenticated',
       'public.persist_chat_turn_idempotent_server(uuid,text,uuid,text,text,text,timestamptz,timestamptz,jsonb,jsonb)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'browser roles can execute a server-only idempotency RPC';
  END IF;

  IF NOT has_function_privilege('service_role', 'public.claim_chat_request_server(uuid,text,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.release_chat_request_server(uuid,text,uuid)', 'EXECUTE')
     OR NOT has_function_privilege(
       'service_role',
       'public.persist_chat_turn_idempotent_server(uuid,text,uuid,text,text,text,timestamptz,timestamptz,jsonb,jsonb)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'service_role is missing an idempotency RPC grant';
  END IF;
END
$idempotency_acl$;
