\set ON_ERROR_STOP on

-- Exercise the database hard cap using an authenticated role and direct inserts
-- (no application-level pruneMemoryLifecycle call is involved).
RESET ROLE;
SET request.jwt.claim.sub = '';
SET ROLE authenticated;
SET request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';

INSERT INTO public.memory_items (user_id, memory_type, content, importance, embedding)
SELECT
  auth.uid(),
  'communication',
  'cap-fixture-' || to_char(n, 'FM000'),
  0.5,
  ('[' || array_to_string(array_fill(0::real, ARRAY[384]), ',') || ']')::extensions.vector(384)
FROM generate_series(1, 55) AS n;

DO $memory_cap$
DECLARE
  actor uuid := auth.uid();
  row_count integer;
  distinct_count integer;
BEGIN
  SELECT count(*), count(distinct id)
  INTO row_count, distinct_count
  FROM public.memory_items
  WHERE user_id = actor
    AND content like 'cap-fixture-%';

  IF row_count <> 50 OR distinct_count <> 50 THEN
    RAISE EXCEPTION 'memory hard cap failed: expected 50 fixture rows, got % rows / % unique IDs', row_count, distinct_count;
  END IF;
END
$memory_cap$;

RESET ROLE;
DELETE FROM public.memory_items
WHERE user_id = '33333333-3333-4333-8333-333333333333'
  AND content like 'cap-fixture-%';
