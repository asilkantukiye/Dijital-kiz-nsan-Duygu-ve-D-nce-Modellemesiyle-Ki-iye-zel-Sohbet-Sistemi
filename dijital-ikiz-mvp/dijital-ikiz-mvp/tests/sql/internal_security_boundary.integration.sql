\set ON_ERROR_STOP on

-- These internal coordination tables intentionally have no user-facing policies.
-- RLS plus the absence of direct anon/authenticated table grants must make them
-- default-deny. The server's service_role client is the only direct table actor.
DO $internal_table_boundary$
DECLARE
  item record;
  table_count integer := 0;
BEGIN
  FOR item IN
    SELECT c.oid::regclass AS table_ref, c.relname, c.relrowsecurity
    FROM pg_class AS c
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname = ANY (ARRAY[
        'chat_rate_limit_counters',
        'chat_request_deduplication',
        'chat_user_data_generations'
      ]::text[])
    ORDER BY c.relname
  LOOP
    table_count := table_count + 1;

    IF item.relrowsecurity IS NOT TRUE THEN
      RAISE EXCEPTION 'Internal table % must retain RLS', item.relname;
    END IF;

    IF has_table_privilege('anon', item.table_ref, 'SELECT')
       OR has_table_privilege('anon', item.table_ref, 'INSERT')
       OR has_table_privilege('anon', item.table_ref, 'UPDATE')
       OR has_table_privilege('anon', item.table_ref, 'DELETE')
       OR has_table_privilege('authenticated', item.table_ref, 'SELECT')
       OR has_table_privilege('authenticated', item.table_ref, 'INSERT')
       OR has_table_privilege('authenticated', item.table_ref, 'UPDATE')
       OR has_table_privilege('authenticated', item.table_ref, 'DELETE') THEN
      RAISE EXCEPTION 'Internal table % has unexpected direct user grants', item.relname;
    END IF;

    IF NOT has_table_privilege('service_role', item.table_ref, 'SELECT')
       OR NOT has_table_privilege('service_role', item.table_ref, 'INSERT')
       OR NOT has_table_privilege('service_role', item.table_ref, 'UPDATE')
       OR NOT has_table_privilege('service_role', item.table_ref, 'DELETE') THEN
      RAISE EXCEPTION 'Internal table % is missing required service_role access', item.relname;
    END IF;
  END LOOP;

  IF table_count <> 3 THEN
    RAISE EXCEPTION 'Expected 3 internal coordination tables; found %', table_count;
  END IF;
END
$internal_table_boundary$;

-- The following SECURITY DEFINER RPCs are intentionally callable by
-- authenticated users because the memory lifecycle uses them. Each must be
-- non-callable by anon/service_role, accept no external user_id, and bind writes
-- to auth.uid(). CI enforces these properties to make the advisor warnings
-- explicit rather than treating them as an unknown exception.
DO $owned_security_definer_boundary$
DECLARE
  item record;
  function_count integer := 0;
  definition text;
BEGIN
  FOR item IN
    SELECT
      p.oid,
      p.oid::regprocedure AS function_ref,
      p.proname,
      p.prosecdef,
      p.pronargs,
      pg_get_functiondef(p.oid) AS source
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY (ARRAY[
        'current_my_chat_data_generation',
        'delete_my_chat_request_claims_for_current_user',
        'persist_my_memory_at_generation'
      ]::text[])
    ORDER BY p.proname
  LOOP
    function_count := function_count + 1;
    definition := lower(item.source);

    IF item.prosecdef IS NOT TRUE THEN
      RAISE EXCEPTION 'Function % must remain SECURITY DEFINER', item.function_ref;
    END IF;

    IF has_function_privilege('anon', item.oid, 'EXECUTE')
       OR has_function_privilege('service_role', item.oid, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', item.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'Function % has an unexpected EXECUTE grant matrix', item.function_ref;
    END IF;

    IF position('auth.uid()' IN definition) = 0 THEN
      RAISE EXCEPTION 'Function % must bind the caller via auth.uid()', item.function_ref;
    END IF;

    IF item.proname IN (
      'current_my_chat_data_generation',
      'delete_my_chat_request_claims_for_current_user'
    ) AND item.pronargs <> 0 THEN
      RAISE EXCEPTION 'Function % must not accept caller-supplied identity arguments', item.function_ref;
    END IF;

    IF item.proname = 'persist_my_memory_at_generation' THEN
      IF position('user_id = v_user_id' IN definition) = 0
         OR position('id = p_source_message_id' IN definition) = 0
         OR position('role = ''user''' IN definition) = 0
         OR position('data_generation' IN definition) = 0 THEN
        RAISE EXCEPTION 'Function % must validate caller-owned source and generation', item.function_ref;
      END IF;
    ELSIF item.proname = 'delete_my_chat_request_claims_for_current_user' THEN
      IF position('user_id = v_user_id' IN definition) = 0
         OR position('generation = generation + 1' IN definition) = 0 THEN
        RAISE EXCEPTION 'Function % must only advance and delete the caller generation/claims', item.function_ref;
      END IF;
    ELSIF item.proname = 'current_my_chat_data_generation' THEN
      IF position('user_id = v_user_id' IN definition) = 0
         OR position('for share' IN definition) = 0 THEN
        RAISE EXCEPTION 'Function % must lock/read only the caller generation', item.function_ref;
      END IF;
    END IF;
  END LOOP;

  IF function_count <> 3 THEN
    RAISE EXCEPTION 'Expected 3 owner-scoped SECURITY DEFINER functions; found %', function_count;
  END IF;
END
$owned_security_definer_boundary$;
