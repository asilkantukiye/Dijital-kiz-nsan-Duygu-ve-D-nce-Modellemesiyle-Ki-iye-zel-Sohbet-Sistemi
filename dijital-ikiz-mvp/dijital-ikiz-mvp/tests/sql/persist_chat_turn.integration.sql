\set ON_ERROR_STOP on

-- The trusted backend writer persists profile + both message rows atomically.
RESET ROLE;
SET ROLE service_role;
SET request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';

SELECT *
FROM public.persist_chat_turn_server(
  '11111111-1111-4111-8111-111111111111'::uuid,
  'personalized',
  'personalized user input',
  'personalized assistant reply',
  '2026-10-20 20:00:00+00'::timestamptz,
  '2026-10-20 20:00:00.001+00'::timestamptz,
  '{"tone":"concise"}'::jsonb
);

RESET ROLE;
SET ROLE authenticated;
SET request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';

DO $$
DECLARE
  actor uuid := auth.uid();
BEGIN
  IF (SELECT count(*) FROM public.messages) <> 2 THEN
    RAISE EXCEPTION 'personalized turn did not persist exactly two messages';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.twin_profiles
    WHERE user_id = actor AND profile = '{"tone":"concise"}'::jsonb
  ) THEN
    RAISE EXCEPTION 'personalized profile was not persisted';
  END IF;

  IF (SELECT created_at FROM public.messages WHERE role = 'assistant')
     <= (SELECT created_at FROM public.messages WHERE role = 'user') THEN
    RAISE EXCEPTION 'message timestamps are not strictly ordered';
  END IF;
END
$$;

-- Baseline turn: messages persist, but no personalized profile is written.
RESET ROLE;
SET ROLE service_role;
SET request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';

SELECT *
FROM public.persist_chat_turn_server(
  '22222222-2222-4222-8222-222222222222'::uuid,
  'baseline',
  'baseline user input',
  'baseline assistant reply',
  '2026-10-20 20:01:00+00'::timestamptz,
  '2026-10-20 20:01:00.001+00'::timestamptz,
  NULL
);

RESET ROLE;
SET ROLE authenticated;
SET request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';

DO $$
DECLARE
  actor uuid := auth.uid();
BEGIN
  IF (SELECT count(*) FROM public.messages) <> 2 THEN
    RAISE EXCEPTION 'baseline turn did not persist exactly two messages';
  END IF;

  IF EXISTS (SELECT 1 FROM public.twin_profiles WHERE user_id = actor) THEN
    RAISE EXCEPTION 'baseline turn unexpectedly persisted a twin profile';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.messages
    WHERE profile_snapshot IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'baseline messages unexpectedly have profile snapshots';
  END IF;
END
$$;

-- RLS still isolates rows for normal user-facing reads.
SET request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';

DO $$
DECLARE
  actor uuid := auth.uid();
BEGIN
  IF (SELECT count(*) FROM public.messages) <> 2 THEN
    RAISE EXCEPTION 'message RLS did not isolate the first user';
  END IF;

  IF EXISTS (SELECT 1 FROM public.messages WHERE user_id <> actor) THEN
    RAISE EXCEPTION 'first user can see another user''s messages';
  END IF;

  IF EXISTS (SELECT 1 FROM public.twin_profiles WHERE user_id <> actor) THEN
    RAISE EXCEPTION 'first user can see another user''s profile';
  END IF;
END
$$;

-- The trusted RPC validates payloads itself even though only service_role can call it.
RESET ROLE;
SET ROLE service_role;

DO $$
DECLARE
  rejected boolean;
BEGIN
  rejected := false;
  BEGIN
    PERFORM * FROM public.persist_chat_turn_server(
      '11111111-1111-4111-8111-111111111111'::uuid,
      'unexpected', 'user', 'assistant',
      '2026-10-20 20:02:00+00', '2026-10-20 20:02:00.001+00', NULL
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'Invalid chat variant' THEN RAISE; END IF;
    rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'invalid variant was accepted'; END IF;

  rejected := false;
  BEGIN
    PERFORM * FROM public.persist_chat_turn_server(
      '11111111-1111-4111-8111-111111111111'::uuid,
      'personalized', repeat('x', 4001), 'assistant',
      '2026-10-20 20:02:00+00', '2026-10-20 20:02:00.001+00', '{"ok":true}'::jsonb
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'Invalid user message' THEN RAISE; END IF;
    rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'oversized user message was accepted'; END IF;

  rejected := false;
  BEGIN
    PERFORM * FROM public.persist_chat_turn_server(
      '11111111-1111-4111-8111-111111111111'::uuid,
      'baseline', 'user', 'assistant',
      '2026-10-20 20:02:00+00', '2026-10-20 20:02:00.001+00', '{"leak":true}'::jsonb
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'Baseline chat cannot persist a profile snapshot' THEN RAISE; END IF;
    rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'baseline profile snapshot was accepted'; END IF;
END
$$;

-- If the second message insert fails, the profile and first message roll back too.
SET request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';

DO $$
DECLARE
  failed_as_expected boolean := false;
  actor uuid := '33333333-3333-4333-8333-333333333333'::uuid;
BEGIN
  BEGIN
    PERFORM * FROM public.persist_chat_turn_server(
      actor,
      'personalized',
      'this user message must roll back',
      'simulate-second-write-failure',
      '2026-10-20 20:03:00+00'::timestamptz,
      '2026-10-20 20:03:00.001+00'::timestamptz,
      '{"temporary":true}'::jsonb
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'simulated assistant insert failure' THEN RAISE; END IF;
    failed_as_expected := true;
  END;

  IF NOT failed_as_expected THEN
    RAISE EXCEPTION 'simulated second-write failure did not occur';
  END IF;

  IF EXISTS (SELECT 1 FROM public.messages WHERE user_id = actor) THEN
    RAISE EXCEPTION 'failed chat turn left behind a message';
  END IF;

  IF EXISTS (SELECT 1 FROM public.twin_profiles WHERE user_id = actor) THEN
    RAISE EXCEPTION 'failed chat turn left behind a profile update';
  END IF;
END
$$;

RESET ROLE;

-- ACLs must prevent any browser/user JWT from calling a trusted chat writer.
DO $acl$
BEGIN
  IF has_function_privilege(
    'anon',
    'public.persist_chat_turn(text,text,text,timestamptz,timestamptz,jsonb)',
    'EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    'public.persist_chat_turn(text,text,text,timestamptz,timestamptz,jsonb)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'anon/authenticated unexpectedly have EXECUTE on legacy persist_chat_turn';
  END IF;

  IF has_function_privilege(
    'anon',
    'public.persist_chat_turn_server(uuid,text,text,text,timestamptz,timestamptz,jsonb)',
    'EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    'public.persist_chat_turn_server(uuid,text,text,text,timestamptz,timestamptz,jsonb)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'anon/authenticated unexpectedly have EXECUTE on persist_chat_turn_server';
  END IF;

  IF NOT has_function_privilege(
    'service_role',
    'public.persist_chat_turn_server(uuid,text,text,text,timestamptz,timestamptz,jsonb)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'service_role is missing EXECUTE on persist_chat_turn_server';
  END IF;
END
$acl$;
