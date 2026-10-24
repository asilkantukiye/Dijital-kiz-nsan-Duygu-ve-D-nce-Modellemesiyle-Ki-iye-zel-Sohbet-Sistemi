\set ON_ERROR_STOP on

-- Run as the database owner after all migrations to prove database-level rejection.
DO $aud05_reject_zero_embedding$
DECLARE
  rejected boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.memory_items (user_id, memory_type, content, importance, embedding)
    VALUES (
      '11111111-1111-4111-8111-111111111111',
      'preference',
      'aud05-zero-embedding-must-fail',
      0.5,
      ('[' || array_to_string(array_fill(0::real, ARRAY[384]), ',') || ']')::extensions.vector(384)
    );
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;

  IF NOT rejected THEN
    RAISE EXCEPTION 'AUD-05 failed: all-zero embedding was accepted by the database';
  END IF;

  IF EXISTS (SELECT 1 FROM public.memory_items WHERE content = 'aud05-zero-embedding-must-fail') THEN
    RAISE EXCEPTION 'AUD-05 failed: rejected zero-embedding row was persisted';
  END IF;
END
$aud05_reject_zero_embedding$;

DO $aud05_embedding_constraint_catalog$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.memory_items'::regclass
      AND conname = 'memory_items_embedding_integrity_check'
      AND contype = 'c'
      AND convalidated
  ) THEN
    RAISE EXCEPTION 'AUD-05 failed: embedding integrity constraint is missing or unvalidated';
  END IF;
END
$aud05_embedding_constraint_catalog$;
