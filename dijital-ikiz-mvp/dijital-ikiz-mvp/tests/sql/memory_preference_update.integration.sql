\set ON_ERROR_STOP on

-- Exercise the same atomic transaction called by persistMemories, using the
-- actual Stage 5 memory schema and authenticated RLS context.
RESET ROLE;

INSERT INTO public.memory_items (user_id, memory_type, content, importance, embedding) VALUES
  ('33333333-3333-4333-8333-333333333333', 'preference', 'Kullanıcı tercihi: şekersiz kahve', 0.7, ('[' || array_to_string(ARRAY[1::real] || array_fill(0::real, ARRAY[383]), ',') || ']')::extensions.vector(384)),
  ('33333333-3333-4333-8333-333333333333', 'preference', 'Kullanıcı tercihi: kahve', 0.6, ('[' || array_to_string(ARRAY[1::real] || array_fill(0::real, ARRAY[383]), ',') || ']')::extensions.vector(384)),
  ('33333333-3333-4333-8333-333333333333', 'preference', 'Kullanıcı tercihi: filtre kahve', 0.6, ('[' || array_to_string(ARRAY[1::real] || array_fill(0::real, ARRAY[383]), ',') || ']')::extensions.vector(384)),
  ('33333333-3333-4333-8333-333333333333', 'preference', 'Kullanıcı tercihi: yeşil çay', 0.6, ('[' || array_to_string(ARRAY[1::real] || array_fill(0::real, ARRAY[383]), ',') || ']')::extensions.vector(384));

SET ROLE authenticated;
SET request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';

DO $atomic_preference_update$
DECLARE
  actor uuid := auth.uid();
  keep_id uuid;
  duplicate_id uuid;
  row_count integer;
BEGIN
  SELECT id INTO keep_id
  FROM public.memory_items
  WHERE user_id = actor AND content = 'Kullanıcı tercihi: şekersiz kahve';

  SELECT id INTO duplicate_id
  FROM public.memory_items
  WHERE user_id = actor AND content = 'Kullanıcı tercihi: kahve';

  IF keep_id IS NULL OR duplicate_id IS NULL THEN
    RAISE EXCEPTION 'preference update fixtures are missing';
  END IF;

  PERFORM public.replace_my_memory_preference(
    keep_id,
    ARRAY[duplicate_id],
    'Kullanıcı tercihi: şekerli kahve',
    0.75,
    ('[' || array_to_string(ARRAY[1::real] || array_fill(0::real, ARRAY[383]), ',') || ']')::extensions.vector(384),
    NULL::uuid
  );

  IF NOT EXISTS (
    SELECT 1 FROM public.memory_items
    WHERE user_id = actor
      AND id = keep_id
      AND content = 'Kullanıcı tercihi: şekerli kahve'
  ) THEN
    RAISE EXCEPTION 'explicit preference update did not update the original row in place';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.memory_items
    WHERE user_id = actor
      AND content IN ('Kullanıcı tercihi: şekersiz kahve', 'Kullanıcı tercihi: kahve')
  ) THEN
    RAISE EXCEPTION 'old or duplicate preference remained after replacement';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.memory_items
    WHERE user_id = actor AND content = 'Kullanıcı tercihi: filtre kahve'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.memory_items
    WHERE user_id = actor AND content = 'Kullanıcı tercihi: yeşil çay'
  ) THEN
    RAISE EXCEPTION 'replacement removed an unrelated preference';
  END IF;

  SELECT count(*) INTO row_count FROM public.memory_items WHERE user_id = actor;
  IF row_count <> 3 THEN
    RAISE EXCEPTION 'preference replacement left an unexpected number of rows';
  END IF;
END
$atomic_preference_update$;

RESET ROLE;
DELETE FROM public.memory_items
WHERE user_id = '33333333-3333-4333-8333-333333333333'
  AND content IN (
    'Kullanıcı tercihi: şekerli kahve',
    'Kullanıcı tercihi: filtre kahve',
    'Kullanıcı tercihi: yeşil çay'
  );

DO $preference_rpc_acl$
BEGIN
  IF has_function_privilege(
    'anon',
    'public.replace_my_memory_preference(uuid,uuid[],text,real,extensions.vector,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'anon unexpectedly has EXECUTE permission on preference replacement RPC';
  END IF;

  IF NOT has_function_privilege(
    'authenticated',
    'public.replace_my_memory_preference(uuid,uuid[],text,real,extensions.vector,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated is missing EXECUTE permission on preference replacement RPC';
  END IF;
END
$preference_rpc_acl$;
