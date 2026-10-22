\set ON_ERROR_STOP on

-- The atomic chat-turn test has populated users one and two with isolated rows.
-- Confirm the deletion RPC fails before touching any rows without an auth claim.
RESET ROLE;
SET request.jwt.claim.sub = '';
DO $unauthenticated_delete$
DECLARE
  rejected boolean := false;
BEGIN
  BEGIN
    PERFORM public.delete_my_chat_data();
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'Authentication required' THEN RAISE; END IF;
    rejected := true;
  END;

  IF NOT rejected THEN
    RAISE EXCEPTION 'unauthenticated deletion was accepted';
  END IF;
END
$unauthenticated_delete$;

-- Seed one memory row per user and valid feedback for user two as the test
-- harness. User one's memory/profile/messages will be removed by the RPC.
INSERT INTO public.memory_items (user_id, memory_type, content, embedding) VALUES
  (
    '11111111-1111-4111-8111-111111111111',
    'preference',
    'private memory for user one',
    ('[' || array_to_string(array_fill(0::real, ARRAY[384]), ',') || ']')::extensions.vector(384)
  ),
  (
    '22222222-2222-4222-8222-222222222222',
    'preference',
    'private memory for user two',
    ('[' || array_to_string(array_fill(0::real, ARRAY[384]), ',') || ']')::extensions.vector(384)
  );

INSERT INTO public.message_feedback (message_id, user_id, rating, variant)
SELECT id, user_id, 4, 'baseline'
FROM public.messages
WHERE user_id = '22222222-2222-4222-8222-222222222222'
  AND role = 'assistant'
  AND variant = 'baseline'
LIMIT 1;

SELECT set_config(
  'test.other_user_assistant_id',
  (
    SELECT id::text
    FROM public.messages
    WHERE user_id = '22222222-2222-4222-8222-222222222222'
      AND role = 'assistant'
      AND variant = 'baseline'
    LIMIT 1
  ),
  false
);

SET ROLE authenticated;
SET request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';

-- Feedback on this user's own assistant reply must succeed.
INSERT INTO public.message_feedback (message_id, user_id, rating, variant)
SELECT id, auth.uid(), 5, 'personalized'
FROM public.messages
WHERE user_id = auth.uid()
  AND role = 'assistant'
  AND variant = 'personalized'
LIMIT 1;

DO $feedback_rls$
DECLARE
  actor uuid := auth.uid();
  own_message uuid;
  other_message uuid := current_setting('test.other_user_assistant_id')::uuid;
  rejected boolean;
BEGIN
  SELECT id INTO own_message
  FROM public.messages
  WHERE user_id = actor
    AND role = 'assistant'
    AND variant = 'personalized'
  LIMIT 1;

  IF own_message IS NULL OR other_message IS NULL THEN
    RAISE EXCEPTION 'feedback test fixtures are missing assistant messages';
  END IF;

  rejected := false;
  BEGIN
    INSERT INTO public.message_feedback (message_id, user_id, rating, variant)
    VALUES (other_message, actor, 4, 'baseline');
  EXCEPTION WHEN insufficient_privilege THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'feedback attached to another user message was accepted';
  END IF;

  rejected := false;
  BEGIN
    INSERT INTO public.message_feedback (message_id, user_id, rating, variant)
    VALUES (own_message, actor, 4, 'baseline');
  EXCEPTION WHEN insufficient_privilege THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'feedback with a mismatched experiment variant was accepted';
  END IF;

  IF (SELECT count(*) FROM public.message_feedback WHERE user_id = actor) <> 1 THEN
    RAISE EXCEPTION 'invalid feedback rows were persisted';
  END IF;
END
$feedback_rls$;

-- Deletion must clean the signed-in user's memory/profile/messages and cascade
-- their feedback while preserving every other user's rows.
DO $delete_my_data$
DECLARE
  actor uuid := auth.uid();
  deletion_result jsonb;
BEGIN
  deletion_result := public.delete_my_chat_data();

  IF (deletion_result ->> 'memories_deleted')::integer <> 1 THEN
    RAISE EXCEPTION 'delete_my_chat_data returned an unexpected memory count';
  END IF;
  IF (deletion_result ->> 'profiles_deleted')::integer <> 1 THEN
    RAISE EXCEPTION 'delete_my_chat_data returned an unexpected profile count';
  END IF;
  IF (deletion_result ->> 'messages_deleted')::integer <> 2 THEN
    RAISE EXCEPTION 'delete_my_chat_data returned an unexpected message count';
  END IF;

  IF EXISTS (SELECT 1 FROM public.memory_items WHERE user_id = actor)
     OR EXISTS (SELECT 1 FROM public.twin_profiles WHERE user_id = actor)
     OR EXISTS (SELECT 1 FROM public.messages WHERE user_id = actor)
     OR EXISTS (SELECT 1 FROM public.message_feedback WHERE user_id = actor) THEN
    RAISE EXCEPTION 'delete_my_chat_data left behind user-owned rows';
  END IF;
END
$delete_my_data$;

RESET ROLE;
DO $other_user_preserved$
BEGIN
  IF (SELECT count(*) FROM public.messages
      WHERE user_id = '22222222-2222-4222-8222-222222222222') <> 2 THEN
    RAISE EXCEPTION 'deleting user one affected user two messages';
  END IF;

  IF (SELECT count(*) FROM public.memory_items
      WHERE user_id = '22222222-2222-4222-8222-222222222222') <> 1 THEN
    RAISE EXCEPTION 'deleting user one affected user two memory';
  END IF;

  IF (SELECT count(*) FROM public.message_feedback
      WHERE user_id = '22222222-2222-4222-8222-222222222222') <> 1 THEN
    RAISE EXCEPTION 'deleting user one affected user two feedback';
  END IF;
END
$other_user_preserved$;
