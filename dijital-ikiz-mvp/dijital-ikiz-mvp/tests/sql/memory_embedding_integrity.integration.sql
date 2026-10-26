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


-- Storage-level normalization: bypass application code with a non-unit vector.
DO $aud07_normalize_embedding$
DECLARE
  stored_norm double precision;
  distance_to_expected double precision;
  expected_unit_vector extensions.vector(384) :=
    ('[' || array_to_string(ARRAY[0.6::real, 0.8::real] || array_fill(0::real, ARRAY[382]), ',') || ']')::extensions.vector(384);
BEGIN
  INSERT INTO public.memory_items (user_id, memory_type, content, importance, embedding)
  VALUES (
    '11111111-1111-4111-8111-111111111111',
    'preference',
    'aud07-normalization-must-be-storage-enforced',
    0.5,
    ('[' || array_to_string(ARRAY[3::real, 4::real] || array_fill(0::real, ARRAY[382]), ',') || ']')::extensions.vector(384)
  );

  SELECT extensions.vector_norm(embedding), embedding OPERATOR(extensions.<->) expected_unit_vector
  INTO stored_norm, distance_to_expected
  FROM public.memory_items
  WHERE content = 'aud07-normalization-must-be-storage-enforced';

  IF stored_norm IS NULL OR abs(stored_norm - 1.0) > 0.001 THEN
    RAISE EXCEPTION 'AUD-07 failed: database did not store a unit-normalized vector (norm=%)', stored_norm;
  END IF;
  IF distance_to_expected IS NULL OR distance_to_expected > 0.001 THEN
    RAISE EXCEPTION 'AUD-07 failed: normalized vector differs from expected unit vector (L2 distance=%)', distance_to_expected;
  END IF;

  DELETE FROM public.memory_items
  WHERE content = 'aud07-normalization-must-be-storage-enforced';
END
$aud07_normalize_embedding$;

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
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.memory_items'::regclass
      AND conname = 'memory_items_embedding_unit_norm_check'
      AND contype = 'c'
      AND convalidated
  ) THEN
    RAISE EXCEPTION 'AUD-07 failed: unit-norm storage constraint is missing or unvalidated';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.memory_items'::regclass
      AND tgname = 'normalize_memory_embedding_before_insert'
      AND NOT tgisinternal
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.memory_items'::regclass
      AND tgname = 'normalize_memory_embedding_before_update'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'AUD-07 failed: storage-level vector normalization triggers are missing';
  END IF;
END
$aud05_embedding_constraint_catalog$;
