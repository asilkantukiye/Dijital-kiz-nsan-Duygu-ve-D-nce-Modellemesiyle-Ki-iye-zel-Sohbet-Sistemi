\set ON_ERROR_STOP on

-- Runs after the complete migration chain against PostgreSQL 17 as the database
-- owner. This deliberately bypasses RLS to prove the composite FK itself is the
-- protection against a forged cross-tenant (memory.user_id, source_message_id) pair.
RESET ROLE;

INSERT INTO public.messages (id, user_id, role, variant, content)
VALUES
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01', '11111111-1111-4111-8111-111111111111', 'user', 'personalized', 'aud04-source-owner-a'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02', '22222222-2222-4222-8222-222222222222', 'user', 'personalized', 'aud04-source-owner-b'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeee03', '11111111-1111-4111-8111-111111111111', 'assistant', 'personalized', 'aud07-assistant-source-must-not-anchor-memory');

INSERT INTO public.memory_items (id, user_id, memory_type, content, importance, embedding, source_message_id)
VALUES
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa41',
    '11111111-1111-4111-8111-111111111111',
    'preference',
    'aud04-valid-memory-owner-a',
    0.6,
    ('[' || array_to_string((ARRAY[1::real] || array_fill(0::real, ARRAY[383])), ',') || ']')::extensions.vector(384),
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01'
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb42',
    '22222222-2222-4222-8222-222222222222',
    'preference',
    'aud04-valid-memory-owner-b',
    0.6,
    ('[' || array_to_string((ARRAY[1::real] || array_fill(0::real, ARRAY[383])), ',') || ']')::extensions.vector(384),
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02'
  );

DO $aud04_reject_cross_tenant_insert$
DECLARE
  rejected boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.memory_items (
      user_id, memory_type, content, importance, embedding, source_message_id
    )
    VALUES (
      '22222222-2222-4222-8222-222222222222',
      'preference',
      'aud04-cross-tenant-insert-must-fail',
      0.7,
      ('[' || array_to_string((ARRAY[1::real] || array_fill(0::real, ARRAY[383])), ',') || ']')::extensions.vector(384),
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01'
    );
  EXCEPTION WHEN foreign_key_violation THEN
    rejected := true;
  END;

  IF NOT rejected THEN
    RAISE EXCEPTION 'AUD-04 failed: cross-tenant source-message insert was accepted';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.memory_items
    WHERE content = 'aud04-cross-tenant-insert-must-fail'
  ) THEN
    RAISE EXCEPTION 'AUD-04 failed: rejected cross-tenant memory row was persisted';
  END IF;
END
$aud04_reject_cross_tenant_insert$;


DO $aud07_reject_assistant_source$
DECLARE
  rejected boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.memory_items (
      user_id, memory_type, content, importance, embedding, source_message_id
    )
    VALUES (
      '11111111-1111-4111-8111-111111111111',
      'preference',
      'aud07-assistant-source-must-fail',
      0.7,
      ('[' || array_to_string((ARRAY[1::real] || array_fill(0::real, ARRAY[383])), ',') || ']')::extensions.vector(384),
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee03'
    );
  EXCEPTION WHEN foreign_key_violation THEN
    rejected := true;
  END;

  IF NOT rejected THEN
    RAISE EXCEPTION 'AUD-07 failed: memory anchored to an assistant message was accepted';
  END IF;

  IF EXISTS (SELECT 1 FROM public.memory_items WHERE content = 'aud07-assistant-source-must-fail') THEN
    RAISE EXCEPTION 'AUD-07 failed: rejected assistant-anchored memory was persisted';
  END IF;
END
$aud07_reject_assistant_source$;

DO $aud04_reject_cross_tenant_update$
DECLARE
  rejected boolean := false;
BEGIN
  BEGIN
    UPDATE public.memory_items
    SET user_id = '22222222-2222-4222-8222-222222222222'
    WHERE id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa41';
  EXCEPTION WHEN foreign_key_violation THEN
    rejected := true;
  END;

  IF NOT rejected THEN
    RAISE EXCEPTION 'AUD-04 failed: cross-tenant ownership update was accepted';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.memory_items
    WHERE id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa41'
      AND user_id = '11111111-1111-4111-8111-111111111111'
      AND source_message_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01'
  ) THEN
    RAISE EXCEPTION 'AUD-04 failed: failed ownership update modified the original row';
  END IF;
END
$aud04_reject_cross_tenant_update$;

-- Deleting the source chat may detach the memory, but it must preserve ownership.
DELETE FROM public.messages
WHERE id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01';

DO $aud04_preserve_memory_owner_on_source_delete$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.memory_items
    WHERE id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa41'
      AND user_id = '11111111-1111-4111-8111-111111111111'
      AND source_message_id IS NULL
  ) THEN
    RAISE EXCEPTION 'AUD-04 failed: source deletion did not preserve the memory owner';
  END IF;
END
$aud04_preserve_memory_owner_on_source_delete$;

DELETE FROM public.memory_items
WHERE id IN (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa41',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb42'
);

DELETE FROM public.messages
WHERE id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02';

-- Catalog-level assertions verify the database actually enforces both key parts.
DO $aud04_constraint_catalog$
DECLARE
  memory_source_attnum smallint;
  memory_user_attnum smallint;
  memory_source_role_attnum smallint;
  message_id_attnum smallint;
  message_user_attnum smallint;
  message_role_attnum smallint;
BEGIN
  SELECT attnum INTO memory_source_attnum FROM pg_attribute
  WHERE attrelid = 'public.memory_items'::regclass AND attname = 'source_message_id' AND NOT attisdropped;
  SELECT attnum INTO memory_user_attnum FROM pg_attribute
  WHERE attrelid = 'public.memory_items'::regclass AND attname = 'user_id' AND NOT attisdropped;
  SELECT attnum INTO memory_source_role_attnum FROM pg_attribute
  WHERE attrelid = 'public.memory_items'::regclass AND attname = 'source_message_role' AND NOT attisdropped;
  SELECT attnum INTO message_id_attnum FROM pg_attribute
  WHERE attrelid = 'public.messages'::regclass AND attname = 'id' AND NOT attisdropped;
  SELECT attnum INTO message_user_attnum FROM pg_attribute
  WHERE attrelid = 'public.messages'::regclass AND attname = 'user_id' AND NOT attisdropped;
  SELECT attnum INTO message_role_attnum FROM pg_attribute
  WHERE attrelid = 'public.messages'::regclass AND attname = 'role' AND NOT attisdropped;

  IF to_regclass('public.messages_id_user_id_uidx') IS NULL
     OR to_regclass('public.messages_id_user_role_uidx') IS NULL THEN
    RAISE EXCEPTION 'AUD-07 failed: composite referenced unique index is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    WHERE c.conrelid = 'public.memory_items'::regclass
      AND c.confrelid = 'public.messages'::regclass
      AND c.contype = 'f'
      AND c.conkey = ARRAY[memory_source_attnum, memory_user_attnum, memory_source_role_attnum]::smallint[]
      AND c.confkey = ARRAY[message_id_attnum, message_user_attnum, message_role_attnum]::smallint[]
      AND c.confdeltype = 'n'
      AND c.confdelsetcols = ARRAY[memory_source_attnum]::smallint[]
  ) THEN
    RAISE EXCEPTION 'AUD-04 failed: memory source composite owner foreign key is missing or malformed';
  END IF;
END
$aud04_constraint_catalog$;
