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
  memory_source_attnum smallint;
  memory_user_attnum smallint;
  message_id_attnum smallint;
  message_user_attnum smallint;
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

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.memory_items'::regclass
      AND conname = 'memory_items_embedding_integrity_check'
      AND contype = 'c'
      AND convalidated
  ) THEN
    RAISE EXCEPTION 'AUD-05 embedding integrity constraint is missing or unvalidated';
  END IF;

  SELECT attnum INTO memory_source_attnum
  FROM pg_attribute
  WHERE attrelid = 'public.memory_items'::regclass AND attname = 'source_message_id' AND NOT attisdropped;
  SELECT attnum INTO memory_user_attnum
  FROM pg_attribute
  WHERE attrelid = 'public.memory_items'::regclass AND attname = 'user_id' AND NOT attisdropped;
  SELECT attnum INTO message_id_attnum
  FROM pg_attribute
  WHERE attrelid = 'public.messages'::regclass AND attname = 'id' AND NOT attisdropped;
  SELECT attnum INTO message_user_attnum
  FROM pg_attribute
  WHERE attrelid = 'public.messages'::regclass AND attname = 'user_id' AND NOT attisdropped;

  IF to_regclass('public.messages_id_user_id_uidx') IS NULL THEN
    RAISE EXCEPTION 'AUD-04 composite messages(id,user_id) unique index is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    WHERE c.conrelid = 'public.memory_items'::regclass
      AND c.confrelid = 'public.messages'::regclass
      AND c.contype = 'f'
      AND c.conkey = ARRAY[memory_source_attnum, memory_user_attnum]::smallint[]
      AND c.confkey = ARRAY[message_id_attnum, message_user_attnum]::smallint[]
      AND c.confdeltype = 'n'
      AND c.confdelsetcols = ARRAY[memory_source_attnum]::smallint[]
  ) THEN
    RAISE EXCEPTION 'AUD-04 memory source composite owner foreign key is missing or malformed';
  END IF;

  FOREACH table_name IN ARRAY ARRAY[
    'twin_profiles',
    'messages',
    'message_feedback',
    'memory_items',
    'chat_request_deduplication',
    'chat_rate_limit_counters',
    'chat_user_data_generations'
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
    'merge_twin_profile_observation',
    'replace_my_memory_preference',
    'consume_chat_rate_limit',
    'get_chat_data_generation_server'
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

    IF function_name IN ('persist_chat_turn', 'persist_chat_turn_server', 'claim_chat_request_server', 'release_chat_request_server', 'persist_chat_turn_idempotent_server', 'merge_twin_profile_observation', 'consume_chat_rate_limit', 'get_chat_data_generation_server') THEN
      IF has_function_privilege('authenticated', function_oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'authenticated unexpectedly has EXECUTE on public.%', function_name;
      END IF;
      IF function_name IN ('persist_chat_turn_server', 'claim_chat_request_server', 'release_chat_request_server', 'persist_chat_turn_idempotent_server', 'merge_twin_profile_observation', 'consume_chat_rate_limit', 'get_chat_data_generation_server')
         AND NOT has_function_privilege('service_role', function_oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'service_role is missing EXECUTE on server-only chat RPC %', function_name;
      END IF;
    ELSE
      IF NOT has_function_privilege('authenticated', function_oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'authenticated is missing EXECUTE on public.%', function_name;
      END IF;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_attribute
    WHERE attrelid = 'public.chat_request_deduplication'::regclass
      AND attname = 'generation'
      AND NOT attisdropped
      AND attnotnull
  ) THEN
    RAISE EXCEPTION 'chat_request_deduplication generation guard column is missing or nullable';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_attribute
    WHERE attrelid = 'public.memory_items'::regclass
      AND attname = 'data_generation'
      AND NOT attisdropped
      AND attnotnull
  ) THEN
    RAISE EXCEPTION 'memory_items data_generation guard column is missing or nullable';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'delete_my_chat_request_claims_for_current_user'
      AND p.pronargs = 0
      AND p.prosecdef
      AND position('search_path=pg_catalog, public' in array_to_string(p.proconfig, ',')) > 0
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'current-user chat-claim deletion helper is missing or has unsafe privileges/search_path';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'current_my_chat_data_generation'
      AND p.pronargs = 0
      AND p.prosecdef
      AND position('search_path=pg_catalog, public' in array_to_string(p.proconfig, ',')) > 0
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'RLS memory generation lock helper is missing or has unsafe privileges/search_path';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'memory_items'
      AND policyname = 'users insert current-generation memory items'
      AND cmd = 'INSERT'
      AND position('current_my_chat_data_generation' in coalesce(with_check, '')) > 0
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'memory_items'
      AND policyname = 'users update current-generation memory items'
      AND cmd = 'UPDATE'
      AND position('current_my_chat_data_generation' in coalesce(qual, '')) > 0
      AND position('current_my_chat_data_generation' in coalesce(with_check, '')) > 0
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'memory_items'
      AND policyname = 'users delete own memory items'
      AND cmd = 'DELETE'
      AND coalesce(with_check, '') = ''
  ) THEN
    RAISE EXCEPTION 'memory RLS policies do not enforce generation-ordered writes and unrestricted own-row deletion';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'persist_my_memory_at_generation'
      AND p.pronargs = 6
      AND p.prosecdef
      AND position('search_path=pg_catalog, public, extensions' in array_to_string(p.proconfig, ',')) > 0
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'generation-guarded memory persistence RPC is missing or has unsafe privileges/search_path';
  END IF;

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

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    WHERE t.tgrelid = 'public.chat_request_deduplication'::regclass
      AND t.tgname = 'chat_request_dedupe_window_10s'
      AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'AUD-06 completed-request 10-second dedupe trigger is missing';
  END IF;

  IF to_regclass('public.messages_user_variant_created_idx') IS NULL THEN
    RAISE EXCEPTION 'variant-scoped message history index is missing';
  END IF;

  IF to_regclass('public.memory_items_source_message_idx') IS NULL THEN
    RAISE EXCEPTION 'memory source-message foreign-key index is missing';
  END IF;

  IF to_regclass('public.memory_items_source_message_owner_idx') IS NULL THEN
    RAISE EXCEPTION 'AUD-04 composite memory source foreign-key index is missing';
  END IF;

  IF to_regclass('public.chat_request_deduplication_user_message_id_idx') IS NULL THEN
    RAISE EXCEPTION 'AUD-02 user-message foreign-key index is missing';
  END IF;

  IF to_regclass('public.chat_request_deduplication_assistant_message_id_idx') IS NULL THEN
    RAISE EXCEPTION 'AUD-02 assistant-message foreign-key index is missing';
  END IF;

END
$migration_catalog$;
