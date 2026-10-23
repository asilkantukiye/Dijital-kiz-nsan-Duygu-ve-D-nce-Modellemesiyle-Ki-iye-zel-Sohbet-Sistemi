\set ON_ERROR_STOP on

-- This test runs after the production migrations (except pg_cron, which is
-- validated separately because stock pgvector/pg17 CI has no pg_cron package).
RESET ROLE;

INSERT INTO public.messages (user_id, role, variant, content)
VALUES (
  '33333333-3333-4333-8333-333333333333',
  'user',
  'personalized',
  'preference RPC integration source message'
);

SELECT set_config(
  'test.preference_source_message_id',
  (
    SELECT id::text
    FROM public.messages
    WHERE user_id = '33333333-3333-4333-8333-333333333333'
      AND role = 'user'
      AND content = 'preference RPC integration source message'
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  ),
  false
);

INSERT INTO public.memory_items (
  user_id, memory_type, content, importance, embedding, preference_key
)
VALUES (
  '11111111-1111-4111-8111-111111111111',
  'preference',
  'foreign-user preference fixture',
  0.5,
  ('[' || array_to_string(array_fill(0::real, ARRAY[384]), ',') || ']')::extensions.vector(384),
  'test::foreign-user-preference'
);

SELECT set_config(
  'test.preference_foreign_memory_id',
  (
    SELECT id::text FROM public.memory_items
    WHERE user_id = '11111111-1111-4111-8111-111111111111'
      AND preference_key = 'test::foreign-user-preference'
  ),
  false
);

SELECT set_config(
  'test.preference_foreign_source_message_id',
  (
    SELECT id::text
    FROM public.messages
    WHERE user_id = '11111111-1111-4111-8111-111111111111'
      AND role = 'user'
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  ),
  false
);

SET ROLE authenticated;
SET request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';

DO $preference_upsert_atomic$
DECLARE
  actor uuid := auth.uid();
  source_id uuid := current_setting('test.preference_source_message_id')::uuid;
  foreign_memory_id uuid := current_setting('test.preference_foreign_memory_id')::uuid;
  first_id uuid;
  second_id uuid;
  inserted_foreign_id uuid;
  foreign_source_id uuid := current_setting('test.preference_foreign_source_message_id')::uuid;
  rejected boolean := false;
  key_count integer;
BEGIN
  first_id := public.upsert_my_memory_preference(
    'sugar::coffee',
    NULL,
    ARRAY[]::uuid[],
    'Kullanıcı tercihi: şekersiz kahve',
    0.7,
    ('[' || array_to_string(ARRAY[1::real] || array_fill(0::real, ARRAY[383]), ',') || ']')::extensions.vector(384),
    source_id
  );

  -- A concurrent/duplicate request with the same semantic key must update the
  -- already keyed row even when its stale caller supplied no keep ID.
  second_id := public.upsert_my_memory_preference(
    'sugar::coffee',
    NULL,
    ARRAY[]::uuid[],
    'Kullanıcı tercihi: şekerli kahve',
    0.75,
    ('[' || array_to_string(ARRAY[1::real] || array_fill(0::real, ARRAY[383]), ',') || ']')::extensions.vector(384),
    source_id
  );

  IF first_id IS DISTINCT FROM second_id THEN
    RAISE EXCEPTION 'same preference key created a second memory row';
  END IF;

  SELECT count(*) INTO key_count
  FROM public.memory_items
  WHERE user_id = actor
    AND memory_type = 'preference'
    AND preference_key = 'sugar::coffee';

  IF key_count <> 1 THEN
    RAISE EXCEPTION 'same preference key is not unique for the user';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.memory_items
    WHERE user_id = actor
      AND id = first_id
      AND content = 'Kullanıcı tercihi: şekerli kahve'
  ) THEN
    RAISE EXCEPTION 'second preference upsert did not update the original row';
  END IF;

  -- Passing another user's keep/duplicate IDs must not update or delete those
  -- rows; the RPC is always scoped by auth.uid() and RLS.
  inserted_foreign_id := public.upsert_my_memory_preference(
    'test::my-own-preference',
    foreign_memory_id,
    ARRAY[foreign_memory_id],
    'Kullanıcı tercihi: benim tercihim',
    0.6,
    ('[' || array_to_string(array_fill(0::real, ARRAY[384]), ',') || ']')::extensions.vector(384),
    source_id
  );

  IF inserted_foreign_id = foreign_memory_id THEN
    RAISE EXCEPTION 'RPC reused a foreign user's memory ID';
  END IF;

  -- A foreign message cannot be used as provenance. The function's exception
  -- aborts all row changes made during that SQL function call.
  BEGIN
    PERFORM public.upsert_my_memory_preference(
      'test::invalid-source',
      NULL,
      ARRAY[]::uuid[],
      'Kullanıcı tercihi: geçersiz kaynak',
      0.5,
      ('[' || array_to_string(array_fill(0::real, ARRAY[384]), ',') || ']')::extensions.vector(384),
      foreign_source_id
    );
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Preference source message not found' THEN RAISE; END IF;
    rejected := true;
  END;

  IF NOT rejected THEN
    RAISE EXCEPTION 'foreign source message was accepted';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.memory_items
    WHERE user_id = actor AND preference_key = 'test::invalid-source'
  ) THEN
    RAISE EXCEPTION 'failed source validation left a partial preference row';
  END IF;
END
$preference_upsert_atomic$;

RESET ROLE;

DO $preference_upsert_cross_tenant$
DECLARE
  foreign_memory_id uuid := current_setting('test.preference_foreign_memory_id')::uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.memory_items
    WHERE id = foreign_memory_id
      AND user_id = '11111111-1111-4111-8111-111111111111'
      AND content = 'foreign-user preference fixture'
      AND preference_key = 'test::foreign-user-preference'
  ) THEN
    RAISE EXCEPTION 'preference RPC altered/deleted another user's row';
  END IF;
END
$preference_upsert_cross_tenant$;

DO $preference_upsert_acl$
BEGIN
  IF has_function_privilege(
    'anon',
    'public.upsert_my_memory_preference(text,uuid,uuid[],text,real,extensions.vector,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'anon unexpectedly has EXECUTE permission on preference upsert RPC';
  END IF;

  IF NOT has_function_privilege(
    'authenticated',
    'public.upsert_my_memory_preference(text,uuid,uuid[],text,real,extensions.vector,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated is missing EXECUTE permission on preference upsert RPC';
  END IF;
END
$preference_upsert_acl$;

DELETE FROM public.memory_items
WHERE user_id IN (
  '11111111-1111-4111-8111-111111111111',
  '33333333-3333-4333-8333-333333333333'
)
AND (
  preference_key IN ('test::foreign-user-preference', 'sugar::coffee', 'test::my-own-preference')
  OR content IN ('foreign-user preference fixture', 'Kullanıcı tercihi: şekerli kahve', 'Kullanıcı tercihi: benim tercihim')
);

DELETE FROM public.messages
WHERE user_id = '33333333-3333-4333-8333-333333333333'
  AND content = 'preference RPC integration source message';
