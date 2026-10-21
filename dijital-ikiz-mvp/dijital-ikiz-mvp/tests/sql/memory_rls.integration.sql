\set ON_ERROR_STOP on

-- This file runs after the production Stage 5 memory migration and after
-- persist_chat_turn.integration.sql populated user A and user B with two chat
-- messages each. The actual migration's RLS policy is under test here.
RESET ROLE;

INSERT INTO public.memory_items (user_id, memory_type, content, embedding) VALUES
  (
    '11111111-1111-4111-8111-111111111111',
    'preference',
    'rls-fixture-memory-user-a',
    ('[' || array_to_string(ARRAY[1::real] || array_fill(0::real, ARRAY[383]), ',') || ']')::extensions.vector(384)
  ),
  (
    '22222222-2222-4222-8222-222222222222',
    'preference',
    'rls-fixture-memory-user-b',
    ('[' || array_to_string(ARRAY[1::real] || array_fill(0::real, ARRAY[383]), ',') || ']')::extensions.vector(384)
  );

-- Authenticated context A: can read and use A's rows, cannot see or mutate B's.
SET ROLE authenticated;
SET request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';

DO $user_a_isolation$
DECLARE
  actor uuid := auth.uid();
  other_user uuid := '22222222-2222-4222-8222-222222222222';
  visible_count integer;
  affected integer;
  rejected boolean;
BEGIN
  IF actor <> '11111111-1111-4111-8111-111111111111'::uuid THEN
    RAISE EXCEPTION 'User A auth.uid() did not resolve to User A';
  END IF;

  SELECT count(*) INTO visible_count FROM public.memory_items;
  IF visible_count <> 1 OR NOT EXISTS (
    SELECT 1 FROM public.memory_items WHERE content = 'rls-fixture-memory-user-a'
  ) THEN
    RAISE EXCEPTION 'User A cannot see exactly their own memory row';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.memory_items WHERE content = 'rls-fixture-memory-user-b'
  ) THEN
    RAISE EXCEPTION 'User A can read User B memory';
  END IF;

  SELECT count(*) INTO visible_count
  FROM public.match_memory_items(
    ('[' || array_to_string(ARRAY[1::real] || array_fill(0::real, ARRAY[383]), ',') || ']')::extensions.vector(384),
    0.5,
    10
  );
  IF visible_count <> 1 OR NOT EXISTS (
    SELECT 1 FROM public.match_memory_items(('[' || array_to_string(ARRAY[1::real] || array_fill(0::real, ARRAY[383]), ',') || ']')::extensions.vector(384), 0.5, 10)
    WHERE content = 'rls-fixture-memory-user-a'
  ) THEN
    RAISE EXCEPTION 'memory matching RPC leaked or hid rows for User A';
  END IF;

  SELECT count(*) INTO visible_count FROM public.messages;
  IF visible_count <> 2 OR EXISTS (
    SELECT 1 FROM public.messages WHERE user_id = other_user
  ) THEN
    RAISE EXCEPTION 'User A can read another user chat messages';
  END IF;

  UPDATE public.memory_items
    SET content = 'rls-tampered-by-user-a'
    WHERE user_id = other_user;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN
    RAISE EXCEPTION 'User A updated a memory owned by User B';
  END IF;

  DELETE FROM public.messages WHERE user_id = other_user;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN
    RAISE EXCEPTION 'User A deleted chat messages owned by User B';
  END IF;

  rejected := false;
  BEGIN
    INSERT INTO public.memory_items (user_id, memory_type, content, importance, embedding)
    VALUES (
      other_user,
      'preference',
      'rls-foreign-memory-insert-by-a',
      0.5,
      ('[' || array_to_string(ARRAY[1::real] || array_fill(0::real, ARRAY[383]), ',') || ']')::extensions.vector(384)
    );
  EXCEPTION WHEN insufficient_privilege THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'User A inserted a memory owned by User B';
  END IF;

  rejected := false;
  BEGIN
    INSERT INTO public.messages (user_id, role, variant, content)
    VALUES (other_user, 'user', 'personalized', 'rls-foreign-chat-insert-by-a');
  EXCEPTION WHEN insufficient_privilege THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'User A inserted a chat message owned by User B';
  END IF;
END
$user_a_isolation$;

-- Authenticated context B: verify the reverse direction independently.
SET request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';

DO $user_b_isolation$
DECLARE
  actor uuid := auth.uid();
  other_user uuid := '11111111-1111-4111-8111-111111111111';
  visible_count integer;
  affected integer;
  rejected boolean;
BEGIN
  IF actor <> '22222222-2222-4222-8222-222222222222'::uuid THEN
    RAISE EXCEPTION 'User B auth.uid() did not resolve to User B';
  END IF;

  SELECT count(*) INTO visible_count FROM public.memory_items;
  IF visible_count <> 1 OR NOT EXISTS (
    SELECT 1 FROM public.memory_items WHERE content = 'rls-fixture-memory-user-b'
  ) THEN
    RAISE EXCEPTION 'User B cannot see exactly their own memory row';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.memory_items WHERE content = 'rls-fixture-memory-user-a'
  ) THEN
    RAISE EXCEPTION 'User B can read User A memory';
  END IF;

  SELECT count(*) INTO visible_count
  FROM public.match_memory_items(
    ('[' || array_to_string(ARRAY[1::real] || array_fill(0::real, ARRAY[383]), ',') || ']')::extensions.vector(384),
    0.5,
    10
  );
  IF visible_count <> 1 OR NOT EXISTS (
    SELECT 1 FROM public.match_memory_items(('[' || array_to_string(ARRAY[1::real] || array_fill(0::real, ARRAY[383]), ',') || ']')::extensions.vector(384), 0.5, 10)
    WHERE content = 'rls-fixture-memory-user-b'
  ) THEN
    RAISE EXCEPTION 'memory matching RPC leaked or hid rows for User B';
  END IF;

  SELECT count(*) INTO visible_count FROM public.messages;
  IF visible_count <> 2 OR EXISTS (
    SELECT 1 FROM public.messages WHERE user_id = other_user
  ) THEN
    RAISE EXCEPTION 'User B can read another user chat messages';
  END IF;

  UPDATE public.memory_items
    SET content = 'rls-tampered-by-user-b'
    WHERE user_id = other_user;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN
    RAISE EXCEPTION 'User B updated a memory owned by User A';
  END IF;

  DELETE FROM public.messages WHERE user_id = other_user;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN
    RAISE EXCEPTION 'User B deleted chat messages owned by User A';
  END IF;

  rejected := false;
  BEGIN
    INSERT INTO public.memory_items (user_id, memory_type, content, importance, embedding)
    VALUES (
      other_user,
      'preference',
      'rls-foreign-memory-insert-by-b',
      0.5,
      ('[' || array_to_string(ARRAY[1::real] || array_fill(0::real, ARRAY[383]), ',') || ']')::extensions.vector(384)
    );
  EXCEPTION WHEN insufficient_privilege THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'User B inserted a memory owned by User A';
  END IF;

  rejected := false;
  BEGIN
    INSERT INTO public.messages (user_id, role, variant, content)
    VALUES (other_user, 'user', 'personalized', 'rls-foreign-chat-insert-by-b');
  EXCEPTION WHEN insufficient_privilege THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'User B inserted a chat message owned by User A';
  END IF;
END
$user_b_isolation$;

-- Remove only the temporary memory rows so later deletion-RPC assertions keep
-- their exact fixture counts.
RESET ROLE;
DELETE FROM public.memory_items
WHERE content IN ('rls-fixture-memory-user-a', 'rls-fixture-memory-user-b');
