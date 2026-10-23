\set ON_ERROR_STOP on

-- These assertions run after all repository migrations have been applied to a
-- clean PostgreSQL + pgvector instance, rather than only checking SQL strings.
DO $migration_catalog$
DECLARE
  extension_schema text;
  embedding_typmod integer;
  table_name text;
  table_oid regclass;
  rls_enabled boolean;
  function_name text;
  function_oid oid;
  is_security_definer boolean;
BEGIN
  SELECT n.nspname
  INTO extension_schema
  FROM pg_extension e
  JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'vector';

  IF extension_schema IS DISTINCT FROM 'extensions' THEN
    RAISE EXCEPTION 'vector extension must be installed in extensions schema';
  END IF;

  SELECT a.atttypmod
  INTO embedding_typmod
  FROM pg_attribute a
  WHERE a.attrelid = 'public.memory_items'::regclass
    AND a.attname = 'embedding'
    AND NOT a.attisdropped;

  IF embedding_typmod IS DISTINCT FROM 384 THEN
    RAISE EXCEPTION 'memory_items.embedding must be vector(384), got typmod %', embedding_typmod;
  END IF;

  FOREACH table_name IN ARRAY ARRAY[
    'twin_profiles',
    'messages',
    'message_feedback',
    'memory_items',
    'chat_request_deduplication'
  ]
  LOOP
    table_oid := to_regclass(format('public.%I', table_name));
    IF table_oid IS NULL THEN
      RAISE EXCEPTION 'required public table is missing: %', table_name;
    END IF;

    SELECT c.relrowsecurity
    INTO rls_enabled
    FROM pg_class c
    WHERE c.oid = table_oid;

    IF rls_enabled IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'row-level security is not enabled on public.%', table_name;
    END IF;
  END LOOP;

  FOREACH function_name IN ARRAY ARRAY[
    'match_memory_items',
    'delete_my_chat_data',
    'persist_chat_turn',
    'persist_chat_turn_server',
    'claim_chat_request_server',
    'release_chat_request_server',
    'persist_chat_turn_idempotent_server',
    'replace_my_memory_preference'
  ]
  LOOP
    function_oid := NULL;
    is_security_definer := NULL;

    SELECT p.oid, p.prosecdef
    INTO function_oid, is_security_definer
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = function_name;

    IF function_oid IS NULL THEN
      RAISE EXCEPTION 'required RPC is missing: public.%', function_name;
    END IF;

    IF is_security_definer IS DISTINCT FROM false THEN
      RAISE EXCEPTION 'public.% must remain SECURITY INVOKER', function_name;
    END IF;

    IF has_function_privilege('anon', function_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'anon unexpectedly has EXECUTE on public.%', function_name;
    END IF;

    IF function_name IN ('persist_chat_turn', 'persist_chat_turn_server', 'claim_chat_request_server', 'release_chat_request_server', 'persist_chat_turn_idempotent_server') THEN
      IF has_function_privilege('authenticated', function_oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'authenticated unexpectedly has EXECUTE on public.%', function_name;
      END IF;
      IF function_name IN ('persist_chat_turn_server', 'claim_chat_request_server', 'release_chat_request_server', 'persist_chat_turn_idempotent_server')
         AND NOT has_function_privilege('service_role', function_oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'service_role is missing EXECUTE on server-only chat RPC %', function_name;
      END IF;
    ELSE
      IF NOT has_function_privilege('authenticated', function_oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'authenticated is missing EXECUTE on public.%', function_name;
      END IF;
    END IF;
  END LOOP;

  IF has_table_privilege('authenticated', 'public.messages', 'INSERT')
     OR has_table_privilege('authenticated', 'public.messages', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.twin_profiles', 'INSERT')
     OR has_table_privilege('authenticated', 'public.twin_profiles', 'UPDATE') THEN
    RAISE EXCEPTION 'authenticated unexpectedly has direct chat/profile write privilege';
  END IF;

  IF NOT has_schema_privilege('authenticated', 'extensions', 'USAGE') THEN
    RAISE EXCEPTION 'authenticated is missing USAGE on extensions schema';
  END IF;

  IF has_schema_privilege('anon', 'extensions', 'USAGE') THEN
    RAISE EXCEPTION 'anon unexpectedly has USAGE on extensions schema';
  END IF;

  IF to_regclass('public.messages_user_variant_created_idx') IS NULL THEN
    RAISE EXCEPTION 'variant-scoped message history index is missing';
  END IF;

  IF to_regclass('public.memory_items_source_message_idx') IS NULL THEN
    RAISE EXCEPTION 'memory source-message foreign-key index is missing';
  END IF;

END
$migration_catalog$;
