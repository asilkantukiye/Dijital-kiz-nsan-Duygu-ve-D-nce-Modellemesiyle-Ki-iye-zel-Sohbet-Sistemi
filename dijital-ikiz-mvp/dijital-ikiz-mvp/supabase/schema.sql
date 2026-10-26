create extension if not exists pgcrypto with schema extensions;
create extension if not exists vector with schema extensions;

create table if not exists public.twin_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  profile jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  variant text not null default 'personalized' check (variant in ('personalized','baseline')),
  content text not null check (char_length(content) between 1 and 4000),
  profile_snapshot jsonb,
  created_at timestamptz not null default now()
);

alter table public.messages add column if not exists variant text not null default 'personalized';
alter table public.messages drop constraint if exists messages_variant_check;
alter table public.messages add constraint messages_variant_check check (variant in ('personalized','baseline'));

alter table public.twin_profiles enable row level security;
alter table public.messages enable row level security;

drop policy if exists "users own twin profile" on public.twin_profiles;
create policy "users own twin profile"
  on public.twin_profiles
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "users own messages" on public.messages;
create policy "users own messages"
  on public.messages
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant usage on schema public to authenticated;
grant usage on schema extensions to authenticated;
grant select, insert, update, delete on public.twin_profiles to authenticated;
grant select, insert, update, delete on public.messages to authenticated;

-- Persist the profile update and paired messages as one transaction.
-- SECURITY INVOKER keeps the existing authenticated grants and RLS policies in force.
create or replace function public.persist_chat_turn(
  p_variant text,
  p_user_content text,
  p_assistant_content text,
  p_user_created_at timestamptz,
  p_assistant_created_at timestamptz,
  p_profile_snapshot jsonb
)
returns table (
  user_message_id uuid,
  assistant_message_id uuid
)
language plpgsql
security invoker
set search_path = pg_catalog, public, extensions
as $$
declare
  v_user_id uuid := auth.uid();
  v_user_message_id uuid;
  v_assistant_message_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_variant is null or p_variant not in ('personalized', 'baseline') then
    raise exception 'Invalid chat variant';
  end if;

  if p_user_content is null or char_length(p_user_content) not between 1 and 4000 then
    raise exception 'Invalid user message';
  end if;

  if p_assistant_content is null or char_length(p_assistant_content) not between 1 and 4000 then
    raise exception 'Invalid assistant message';
  end if;

  if p_user_created_at is null
     or p_assistant_created_at is null
     or p_assistant_created_at <= p_user_created_at then
    raise exception 'Invalid chat timestamps';
  end if;

  if p_variant = 'personalized' then
    if p_profile_snapshot is null
       or jsonb_typeof(p_profile_snapshot) is distinct from 'object' then
      raise exception 'Personalized chat requires an object profile';
    end if;

    insert into public.twin_profiles (user_id, profile, updated_at)
    values (v_user_id, p_profile_snapshot, p_assistant_created_at)
    on conflict (user_id) do update
      set profile = excluded.profile,
          updated_at = excluded.updated_at;
  elsif p_profile_snapshot is not null then
    raise exception 'Baseline chat cannot persist a profile snapshot';
  end if;

  insert into public.messages (
    user_id, role, variant, content, profile_snapshot, created_at
  )
  values (
    v_user_id, 'user', p_variant, p_user_content, p_profile_snapshot, p_user_created_at
  )
  returning id into v_user_message_id;

  insert into public.messages (
    user_id, role, variant, content, profile_snapshot, created_at
  )
  values (
    v_user_id, 'assistant', p_variant, p_assistant_content, p_profile_snapshot, p_assistant_created_at
  )
  returning id into v_assistant_message_id;

  return query select v_user_message_id, v_assistant_message_id;
end;
$$;

revoke all on function public.persist_chat_turn(text, text, text, timestamptz, timestamptz, jsonb) from public;
revoke all on function public.persist_chat_turn(text, text, text, timestamptz, timestamptz, jsonb) from anon;
grant execute on function public.persist_chat_turn(text, text, text, timestamptz, timestamptz, jsonb) to authenticated;

create index if not exists messages_user_created_idx
  on public.messages(user_id, created_at desc);

create index if not exists messages_user_variant_created_idx
  on public.messages(user_id, variant, created_at desc);


create table if not exists public.message_feedback (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  variant text not null default 'personalized' check (variant in ('personalized','baseline')),
  comment text check (comment is null or char_length(comment) <= 1000),
  created_at timestamptz not null default now(),
  unique (message_id, user_id)
);

alter table public.message_feedback enable row level security;

-- Remove legacy rows that do not point to the same user's assistant reply
-- and matching experiment variant. The route validates this too, but RLS must
-- enforce the relationship for direct PostgREST access as well.
delete from public.message_feedback as feedback
where not exists (
  select 1
  from public.messages as referenced_message
  where referenced_message.id = feedback.message_id
    and referenced_message.user_id = feedback.user_id
    and referenced_message.role = 'assistant'
    and referenced_message.variant = feedback.variant
);

drop policy if exists "users own feedback" on public.message_feedback;
create policy "users own feedback"
  on public.message_feedback
  for all
  to authenticated
  using (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.messages as referenced_message
      where referenced_message.id = message_feedback.message_id
        and referenced_message.user_id = (select auth.uid())
        and referenced_message.role = 'assistant'
        and referenced_message.variant = message_feedback.variant
    )
  )
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.messages as referenced_message
      where referenced_message.id = message_feedback.message_id
        and referenced_message.user_id = (select auth.uid())
        and referenced_message.role = 'assistant'
        and referenced_message.variant = message_feedback.variant
    )
  );

grant select, insert, update, delete on public.message_feedback to authenticated;

create index if not exists message_feedback_user_created_idx
  on public.message_feedback(user_id, created_at desc);


-- Stage 5 memory engine
create extension if not exists vector with schema extensions;

create table if not exists public.memory_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  memory_type text not null check (memory_type in ('preference', 'communication')),
  content text not null check (char_length(content) between 2 and 240),
  importance real not null default 0.5 check (importance between 0 and 1),
  embedding extensions.vector(384) not null,
  source_message_id uuid references public.messages(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_used_at timestamptz
);

alter table public.memory_items enable row level security;

drop policy if exists "users own memory items" on public.memory_items;
create policy "users own memory items"
  on public.memory_items
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.memory_items to authenticated;

create unique index if not exists memory_items_user_content_uidx
  on public.memory_items(user_id, content);

create index if not exists memory_items_user_updated_idx
  on public.memory_items(user_id, updated_at desc);

create index if not exists memory_items_user_last_used_idx
  on public.memory_items(user_id, last_used_at desc);

create index if not exists memory_items_source_message_idx
  on public.memory_items(source_message_id);

create index if not exists memory_items_embedding_hnsw_idx
  on public.memory_items
  using hnsw (embedding vector_cosine_ops);

create or replace function public.match_memory_items(
  query_embedding extensions.vector(384),
  match_threshold float,
  match_count int
)
returns table (
  id uuid,
  memory_type text,
  content text,
  importance real,
  similarity float,
  created_at timestamptz
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select
    memory_items.id,
    memory_items.memory_type,
    memory_items.content,
    memory_items.importance,
    (1 - (memory_items.embedding <=> query_embedding))::float as similarity,
    memory_items.created_at
  from public.memory_items
  where memory_items.user_id = (select auth.uid())
    and (1 - (memory_items.embedding <=> query_embedding)) >= greatest(0, least(match_threshold, 1))
  order by memory_items.embedding <=> query_embedding asc,
           memory_items.importance desc,
           memory_items.created_at desc
  limit least(greatest(coalesce(match_count, 1), 1), 20);
$$;

revoke all on function public.match_memory_items(extensions.vector(384), float, int) from public;
revoke all on function public.match_memory_items(extensions.vector(384), float, int) from anon;
grant execute on function public.match_memory_items(extensions.vector(384), float, int) to authenticated;


-- Atomically replace an explicitly changed preference and remove stale same-topic rows.
-- SECURITY INVOKER preserves the authenticated caller's table grants and RLS policies.
create or replace function public.replace_my_memory_preference(
  p_keep_id uuid,
  p_duplicate_ids uuid[],
  p_content text,
  p_importance real,
  p_embedding extensions.vector(384),
  p_source_message_id uuid
)
returns void
language plpgsql
security invoker
set search_path = pg_catalog, public, extensions
as $$
declare
  v_user_id uuid := auth.uid();
  v_updated integer := 0;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_keep_id is null
     or p_content is null
     or char_length(p_content) not between 2 and 240
     or p_importance is null
     or p_importance not between 0 and 1
     or p_embedding is null then
    raise exception 'Invalid preference replacement payload';
  end if;

  update public.memory_items
  set content = p_content,
      importance = p_importance,
      embedding = p_embedding,
      source_message_id = p_source_message_id,
      updated_at = now()
  where id = p_keep_id
    and user_id = v_user_id
    and memory_type = 'preference';

  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'Preference memory not found';
  end if;

  delete from public.memory_items
  where user_id = v_user_id
    and memory_type = 'preference'
    and id <> p_keep_id
    and id = any(coalesce(p_duplicate_ids, array[]::uuid[]));
end;
$$;

revoke all on function public.replace_my_memory_preference(
  uuid, uuid[], text, real, extensions.vector(384), uuid
) from public;
revoke all on function public.replace_my_memory_preference(
  uuid, uuid[], text, real, extensions.vector(384), uuid
) from anon;
grant execute on function public.replace_my_memory_preference(
  uuid, uuid[], text, real, extensions.vector(384), uuid
) to authenticated;


-- Delete the signed-in user's chat-specific data atomically.
-- This function deliberately uses SECURITY INVOKER so table grants and RLS
-- policies are enforced as the authenticated caller. It does not delete auth.users.
create or replace function public.delete_my_chat_data()
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, extensions
as $$
declare
  deleted_memories integer := 0;
  deleted_profiles integer := 0;
  deleted_messages integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  delete from public.memory_items
  where user_id = (select auth.uid());
  get diagnostics deleted_memories = row_count;

  delete from public.twin_profiles
  where user_id = (select auth.uid());
  get diagnostics deleted_profiles = row_count;

  -- message_feedback rows are deleted by the messages FK's ON DELETE CASCADE.
  delete from public.messages
  where user_id = (select auth.uid());
  get diagnostics deleted_messages = row_count;

  return jsonb_build_object(
    'memories_deleted', deleted_memories,
    'profiles_deleted', deleted_profiles,
    'messages_deleted', deleted_messages
  );
end;
$$;

revoke all on function public.delete_my_chat_data() from public;
revoke all on function public.delete_my_chat_data() from anon;
grant execute on function public.delete_my_chat_data() to authenticated;

-- AUD-01: only the trusted server writer may append chat turns or update profiles.
-- Browser sessions may read their own messages/profile and delete their own data,
-- but cannot manufacture assistant turns or alter the profile snapshot directly.

REVOKE INSERT, UPDATE ON TABLE public.messages, public.twin_profiles FROM authenticated;

-- The legacy RPC is callable with a user JWT and accepts arbitrary assistant text.
-- Keep its signature for migration compatibility, but remove all API-role access.
REVOKE ALL ON FUNCTION public.persist_chat_turn(
  text, text, text, timestamptz, timestamptz, jsonb
) FROM PUBLIC, anon, authenticated;

GRANT USAGE ON SCHEMA public TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.messages, public.twin_profiles TO service_role;

CREATE OR REPLACE FUNCTION public.persist_chat_turn_server(
  p_user_id uuid,
  p_variant text,
  p_user_content text,
  p_assistant_content text,
  p_user_created_at timestamptz,
  p_assistant_created_at timestamptz,
  p_profile_snapshot jsonb
)
RETURNS TABLE (
  user_message_id uuid,
  assistant_message_id uuid
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_message_id uuid;
  v_assistant_message_id uuid;
BEGIN
  -- EXECUTE ACL is the primary gate. This additional assertion guards accidental
  -- future GRANT changes and fails closed if this function is invoked as a user.
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'Server-only chat writer'
      USING ERRCODE = '42501';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'User id is required';
  END IF;

  IF p_variant IS NULL OR p_variant NOT IN ('personalized', 'baseline') THEN
    RAISE EXCEPTION 'Invalid chat variant';
  END IF;

  IF p_user_content IS NULL OR char_length(p_user_content) NOT BETWEEN 1 AND 4000 THEN
    RAISE EXCEPTION 'Invalid user message';
  END IF;

  IF p_assistant_content IS NULL OR char_length(p_assistant_content) NOT BETWEEN 1 AND 4000 THEN
    RAISE EXCEPTION 'Invalid assistant message';
  END IF;

  IF p_user_created_at IS NULL
     OR p_assistant_created_at IS NULL
     OR p_assistant_created_at <= p_user_created_at THEN
    RAISE EXCEPTION 'Invalid chat timestamps';
  END IF;

  IF p_variant = 'personalized' THEN
    IF p_profile_snapshot IS NULL
       OR jsonb_typeof(p_profile_snapshot) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'Personalized chat requires an object profile';
    END IF;

    INSERT INTO public.twin_profiles (user_id, profile, updated_at)
    VALUES (p_user_id, p_profile_snapshot, p_assistant_created_at)
    ON CONFLICT (user_id) DO UPDATE
      SET profile = EXCLUDED.profile,
          updated_at = EXCLUDED.updated_at;
  ELSIF p_profile_snapshot IS NOT NULL THEN
    RAISE EXCEPTION 'Baseline chat cannot persist a profile snapshot';
  END IF;

  INSERT INTO public.messages (
    user_id, role, variant, content, profile_snapshot, created_at
  )
  VALUES (
    p_user_id, 'user', p_variant, p_user_content, p_profile_snapshot, p_user_created_at
  )
  RETURNING id INTO v_user_message_id;

  INSERT INTO public.messages (
    user_id, role, variant, content, profile_snapshot, created_at
  )
  VALUES (
    p_user_id, 'assistant', p_variant, p_assistant_content, p_profile_snapshot, p_assistant_created_at
  )
  RETURNING id INTO v_assistant_message_id;

  RETURN QUERY SELECT v_user_message_id, v_assistant_message_id;
END;
$$;

REVOKE ALL ON FUNCTION public.persist_chat_turn_server(
  uuid, text, text, text, timestamptz, timestamptz, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.persist_chat_turn_server(
  uuid, text, text, text, timestamptz, timestamptz, jsonb
) TO service_role;

-- AUD-02: deduplicate same-user, same-variant, same-prompt chat requests.
-- Only a short-lived SHA-256 fingerprint is stored; the prompt itself is not copied
-- into this table. Claiming is an atomic INSERT/ON CONFLICT operation.
CREATE TABLE public.chat_request_deduplication (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'completed', 'failed')),
  owner_token uuid,
  response jsonb,
  user_message_id uuid REFERENCES public.messages(id) ON DELETE CASCADE,
  assistant_message_id uuid REFERENCES public.messages(id) ON DELETE CASCADE,
  lease_expires_at timestamptz,
  dedupe_expires_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (user_id, request_hash),
  CHECK (
    (status = 'processing' AND owner_token IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (status <> 'processing' AND owner_token IS NULL AND lease_expires_at IS NULL)
  ),
  CHECK (
    status <> 'completed'
    OR (
      response IS NOT NULL
      AND user_message_id IS NOT NULL
      AND assistant_message_id IS NOT NULL
    )
  )
);

ALTER TABLE public.chat_request_deduplication ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.chat_request_deduplication FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.chat_request_deduplication TO service_role;
GRANT USAGE ON SCHEMA public TO service_role;

CREATE INDEX chat_request_deduplication_expiry_idx
  ON public.chat_request_deduplication (dedupe_expires_at, updated_at);

CREATE INDEX IF NOT EXISTS chat_request_deduplication_user_message_id_idx
  ON public.chat_request_deduplication (user_message_id);

CREATE INDEX IF NOT EXISTS chat_request_deduplication_assistant_message_id_idx
  ON public.chat_request_deduplication (assistant_message_id);

CREATE OR REPLACE FUNCTION public.claim_chat_request_server(
  p_user_id uuid,
  p_request_hash text,
  p_owner_token uuid
)
RETURNS TABLE (
  disposition text,
  response jsonb,
  lease_expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_claimed_owner uuid;
  v_claimed_lease timestamptz;
  v_existing public.chat_request_deduplication%ROWTYPE;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'Server-only chat idempotency claim'
      USING ERRCODE = '42501';
  END IF;

  IF p_user_id IS NULL OR p_owner_token IS NULL THEN
    RAISE EXCEPTION 'Chat request identity is required';
  END IF;

  IF p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid chat request hash';
  END IF;

  -- Opportunistic bounded cleanup prevents old response payloads from accumulating.
  -- Expired message fingerprints are metadata only; chat messages are not deleted here.
  DELETE FROM public.chat_request_deduplication AS expired
  WHERE expired.ctid IN (
    SELECT candidate.ctid
    FROM public.chat_request_deduplication AS candidate
    WHERE (
      candidate.status IN ('completed', 'failed')
      AND candidate.dedupe_expires_at <= clock_timestamp()
    ) OR (
      candidate.status = 'processing'
      AND candidate.lease_expires_at < clock_timestamp() - interval '1 hour'
    )
    ORDER BY candidate.updated_at
    LIMIT 100
  );

  INSERT INTO public.chat_request_deduplication (
    user_id, request_hash, status, owner_token, lease_expires_at,
    dedupe_expires_at, created_at, updated_at
  )
  VALUES (
    p_user_id, p_request_hash, 'processing', p_owner_token,
    clock_timestamp() + interval '5 minutes',
    clock_timestamp() + interval '5 minutes',
    clock_timestamp(), clock_timestamp()
  )
  ON CONFLICT (user_id, request_hash) DO UPDATE
    SET status = 'processing',
        owner_token = EXCLUDED.owner_token,
        response = NULL,
        user_message_id = NULL,
        assistant_message_id = NULL,
        lease_expires_at = EXCLUDED.lease_expires_at,
        dedupe_expires_at = EXCLUDED.dedupe_expires_at,
        created_at = clock_timestamp(),
        updated_at = clock_timestamp()
    WHERE public.chat_request_deduplication.status = 'failed'
       OR (
         public.chat_request_deduplication.status = 'processing'
         AND public.chat_request_deduplication.lease_expires_at <= clock_timestamp()
       )
       OR (
         public.chat_request_deduplication.status = 'completed'
         AND public.chat_request_deduplication.dedupe_expires_at <= clock_timestamp()
       )
  RETURNING owner_token, public.chat_request_deduplication.lease_expires_at
  INTO v_claimed_owner, v_claimed_lease;

  IF FOUND THEN
    RETURN QUERY SELECT 'claimed'::text, NULL::jsonb, v_claimed_lease;
    RETURN;
  END IF;

  SELECT *
  INTO v_existing
  FROM public.chat_request_deduplication
  WHERE user_id = p_user_id
    AND request_hash = p_request_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Chat request claim disappeared'
      USING ERRCODE = '40001';
  END IF;

  IF v_existing.status = 'completed'
     AND v_existing.dedupe_expires_at > clock_timestamp() THEN
    RETURN QUERY SELECT 'replay'::text, v_existing.response, v_existing.lease_expires_at;
    RETURN;
  END IF;

  IF v_existing.status = 'processing'
     AND v_existing.lease_expires_at > clock_timestamp() THEN
    RETURN QUERY SELECT 'in_progress'::text, NULL::jsonb, v_existing.lease_expires_at;
    RETURN;
  END IF;

  RAISE EXCEPTION 'Chat request claim must be retried'
    USING ERRCODE = '40001';
END;
$$;

CREATE OR REPLACE FUNCTION public.release_chat_request_server(
  p_user_id uuid,
  p_request_hash text,
  p_owner_token uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'Server-only chat idempotency release'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.chat_request_deduplication
  SET status = 'failed',
      owner_token = NULL,
      response = NULL,
      user_message_id = NULL,
      assistant_message_id = NULL,
      lease_expires_at = NULL,
      dedupe_expires_at = clock_timestamp(),
      updated_at = clock_timestamp()
  WHERE user_id = p_user_id
    AND request_hash = p_request_hash
    AND status = 'processing'
    AND owner_token = p_owner_token;
END;
$$;

CREATE OR REPLACE FUNCTION public.persist_chat_turn_idempotent_server(
  p_user_id uuid,
  p_request_hash text,
  p_owner_token uuid,
  p_variant text,
  p_user_content text,
  p_assistant_content text,
  p_user_created_at timestamptz,
  p_assistant_created_at timestamptz,
  p_profile_snapshot jsonb,
  p_response_payload jsonb
)
RETURNS TABLE (
  user_message_id uuid,
  assistant_message_id uuid,
  response jsonb,
  disposition text
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_claim public.chat_request_deduplication%ROWTYPE;
  v_user_message_id uuid;
  v_assistant_message_id uuid;
  v_response jsonb;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'Server-only idempotent chat writer'
      USING ERRCODE = '42501';
  END IF;

  IF p_user_id IS NULL OR p_owner_token IS NULL THEN
    RAISE EXCEPTION 'Chat request identity is required';
  END IF;

  IF p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid chat request hash';
  END IF;

  SELECT *
  INTO v_claim
  FROM public.chat_request_deduplication
  WHERE user_id = p_user_id
    AND request_hash = p_request_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Chat request was not claimed';
  END IF;

  -- A late duplicate completion can read the committed result, but cannot write
  -- another profile/message pair.
  IF v_claim.status = 'completed' THEN
    RETURN QUERY SELECT
      v_claim.user_message_id,
      v_claim.assistant_message_id,
      v_claim.response,
      'replay'::text;
    RETURN;
  END IF;

  IF v_claim.status <> 'processing'
     OR v_claim.owner_token IS DISTINCT FROM p_owner_token THEN
    RAISE EXCEPTION 'Chat request claim is not owned by this worker'
      USING ERRCODE = '40001';
  END IF;

  IF p_variant IS NULL OR p_variant NOT IN ('personalized', 'baseline') THEN
    RAISE EXCEPTION 'Invalid chat variant';
  END IF;

  IF p_user_content IS NULL OR char_length(p_user_content) NOT BETWEEN 1 AND 4000 THEN
    RAISE EXCEPTION 'Invalid user message';
  END IF;

  IF p_assistant_content IS NULL OR char_length(p_assistant_content) NOT BETWEEN 1 AND 4000 THEN
    RAISE EXCEPTION 'Invalid assistant message';
  END IF;

  IF p_user_created_at IS NULL
     OR p_assistant_created_at IS NULL
     OR p_assistant_created_at <= p_user_created_at THEN
    RAISE EXCEPTION 'Invalid chat timestamps';
  END IF;

  IF jsonb_typeof(p_response_payload) IS DISTINCT FROM 'object'
     OR COALESCE(p_response_payload ->> 'reply', '') = ''
     OR p_response_payload ->> 'variant' IS DISTINCT FROM p_variant THEN
    RAISE EXCEPTION 'Invalid cached chat response';
  END IF;

  IF p_variant = 'personalized' THEN
    IF p_profile_snapshot IS NULL
       OR jsonb_typeof(p_profile_snapshot) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'Personalized chat requires an object profile';
    END IF;

    INSERT INTO public.twin_profiles (user_id, profile, updated_at)
    VALUES (p_user_id, p_profile_snapshot, p_assistant_created_at)
    ON CONFLICT (user_id) DO UPDATE
      SET profile = EXCLUDED.profile,
          updated_at = EXCLUDED.updated_at;
  ELSIF p_profile_snapshot IS NOT NULL THEN
    RAISE EXCEPTION 'Baseline chat cannot persist a profile snapshot';
  END IF;

  INSERT INTO public.messages (
    user_id, role, variant, content, profile_snapshot, created_at
  )
  VALUES (
    p_user_id, 'user', p_variant, p_user_content, p_profile_snapshot, p_user_created_at
  )
  RETURNING id INTO v_user_message_id;

  INSERT INTO public.messages (
    user_id, role, variant, content, profile_snapshot, created_at
  )
  VALUES (
    p_user_id, 'assistant', p_variant, p_assistant_content, p_profile_snapshot, p_assistant_created_at
  )
  RETURNING id INTO v_assistant_message_id;

  v_response := p_response_payload || jsonb_build_object('messageId', v_assistant_message_id::text);

  UPDATE public.chat_request_deduplication
  SET status = 'completed',
      owner_token = NULL,
      response = v_response,
      user_message_id = v_user_message_id,
      assistant_message_id = v_assistant_message_id,
      lease_expires_at = NULL,
      dedupe_expires_at = clock_timestamp() + interval '10 seconds',
      updated_at = clock_timestamp()
  WHERE user_id = p_user_id
    AND request_hash = p_request_hash
    AND status = 'processing'
    AND owner_token = p_owner_token;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Chat request ownership changed during persistence'
      USING ERRCODE = '40001';
  END IF;

  RETURN QUERY SELECT
    v_user_message_id,
    v_assistant_message_id,
    v_response,
    'completed'::text;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_chat_request_server(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_chat_request_server(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.persist_chat_turn_idempotent_server(
  uuid, text, uuid, text, text, text, timestamptz, timestamptz, jsonb, jsonb
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_chat_request_server(uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_chat_request_server(uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.persist_chat_turn_idempotent_server(
  uuid, text, uuid, text, text, text, timestamptz, timestamptz, jsonb, jsonb
) TO service_role;


-- AUD-03: merge each message's profile observation with the latest committed profile.
-- The upsert's conflicting-row lock serializes writes, preventing stale snapshots from
-- replacing trait updates produced by concurrent, different chat requests.

CREATE OR REPLACE FUNCTION public.merge_twin_profile_observation(
  p_current jsonb,
  p_observation jsonb
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE(
    jsonb_object_agg(
      incoming.key,
      to_jsonb(
        CASE
          WHEN jsonb_typeof(p_current -> incoming.key) = 'number' THEN
            GREATEST(
              0::numeric,
              LEAST(
                1::numeric,
                (p_current ->> incoming.key)::numeric * 0.75
                  + (incoming.value #>> '{}')::numeric * 0.25
              )
            )
          ELSE (incoming.value #>> '{}')::numeric
        END
      )
    ),
    '{}'::jsonb
  )
  FROM jsonb_each(p_observation) AS incoming(key, value);
$$;

REVOKE ALL ON FUNCTION public.merge_twin_profile_observation(jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_twin_profile_observation(jsonb, jsonb)
  TO service_role;

-- Preserve the AUD-02 function signature so existing server callers keep working.
-- p_profile_snapshot now carries a validated per-message observation, not a stale
-- complete snapshot. The value returned by the atomic UPSERT is the canonical state.
CREATE OR REPLACE FUNCTION public.persist_chat_turn_idempotent_server(
  p_user_id uuid,
  p_request_hash text,
  p_owner_token uuid,
  p_variant text,
  p_user_content text,
  p_assistant_content text,
  p_user_created_at timestamptz,
  p_assistant_created_at timestamptz,
  p_profile_snapshot jsonb,
  p_response_payload jsonb
)
RETURNS TABLE (
  user_message_id uuid,
  assistant_message_id uuid,
  response jsonb,
  disposition text
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_claim public.chat_request_deduplication%ROWTYPE;
  v_user_message_id uuid;
  v_assistant_message_id uuid;
  v_profile_snapshot jsonb;
  v_response jsonb;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'Server-only idempotent chat writer'
      USING ERRCODE = '42501';
  END IF;

  IF p_user_id IS NULL OR p_owner_token IS NULL THEN
    RAISE EXCEPTION 'Chat request identity is required';
  END IF;

  IF p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid chat request hash';
  END IF;

  SELECT *
  INTO v_claim
  FROM public.chat_request_deduplication
  WHERE user_id = p_user_id
    AND request_hash = p_request_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Chat request was not claimed';
  END IF;

  IF v_claim.status = 'completed' THEN
    RETURN QUERY SELECT
      v_claim.user_message_id,
      v_claim.assistant_message_id,
      v_claim.response,
      'replay'::text;
    RETURN;
  END IF;

  IF v_claim.status <> 'processing'
     OR v_claim.owner_token IS DISTINCT FROM p_owner_token THEN
    RAISE EXCEPTION 'Chat request claim is not owned by this worker'
      USING ERRCODE = '40001';
  END IF;

  IF p_variant IS NULL OR p_variant NOT IN ('personalized', 'baseline') THEN
    RAISE EXCEPTION 'Invalid chat variant';
  END IF;

  IF p_user_content IS NULL OR char_length(p_user_content) NOT BETWEEN 1 AND 4000 THEN
    RAISE EXCEPTION 'Invalid user message';
  END IF;

  IF p_assistant_content IS NULL OR char_length(p_assistant_content) NOT BETWEEN 1 AND 4000 THEN
    RAISE EXCEPTION 'Invalid assistant message';
  END IF;

  IF p_user_created_at IS NULL
     OR p_assistant_created_at IS NULL
     OR p_assistant_created_at <= p_user_created_at THEN
    RAISE EXCEPTION 'Invalid chat timestamps';
  END IF;

  IF jsonb_typeof(p_response_payload) IS DISTINCT FROM 'object'
     OR COALESCE(p_response_payload ->> 'reply', '') = ''
     OR p_response_payload ->> 'variant' IS DISTINCT FROM p_variant THEN
    RAISE EXCEPTION 'Invalid cached chat response';
  END IF;

  IF p_variant = 'personalized' THEN
    IF p_profile_snapshot IS NULL
       OR jsonb_typeof(p_profile_snapshot) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'Personalized chat requires a profile observation';
    END IF;

    IF (SELECT count(*) FROM jsonb_object_keys(p_profile_snapshot)) <> 13
       OR EXISTS (
         SELECT 1
         FROM jsonb_each(p_profile_snapshot) AS item(key, value)
         WHERE NOT (item.key = ANY (ARRAY[
           'valence', 'arousal', 'dominance', 'openness',
           'conscientiousness', 'extraversion', 'agreeableness',
           'neuroticism', 'informality', 'emoji_frequency',
           'humor', 'slang', 'avg_sentence_length'
         ]::text[]))
         OR NOT (
           CASE
             WHEN jsonb_typeof(item.value) = 'number'
               THEN (item.value #>> '{}')::numeric BETWEEN 0 AND 1
             ELSE false
           END
         )
       ) THEN
      RAISE EXCEPTION 'Invalid profile observation payload';
    END IF;

    -- PostgreSQL serializes concurrent inserts/updates on the unique user_id row.
    -- Crucially, the UPDATE combines EXCLUDED observation with the locked row instead
    -- of assigning EXCLUDED.profile directly, so concurrent traits cannot be lost.
    INSERT INTO public.twin_profiles (user_id, profile, updated_at)
    VALUES (p_user_id, p_profile_snapshot, clock_timestamp())
    ON CONFLICT (user_id) DO UPDATE
      SET profile = public.merge_twin_profile_observation(
            twin_profiles.profile,
            EXCLUDED.profile
          ),
          updated_at = clock_timestamp()
    RETURNING profile INTO v_profile_snapshot;
  ELSIF p_profile_snapshot IS NOT NULL THEN
    RAISE EXCEPTION 'Baseline chat cannot persist a profile observation';
  END IF;

  INSERT INTO public.messages (
    user_id, role, variant, content, profile_snapshot, created_at
  )
  VALUES (
    p_user_id, 'user', p_variant, p_user_content, v_profile_snapshot, p_user_created_at
  )
  RETURNING id INTO v_user_message_id;

  INSERT INTO public.messages (
    user_id, role, variant, content, profile_snapshot, created_at
  )
  VALUES (
    p_user_id, 'assistant', p_variant, p_assistant_content, v_profile_snapshot, p_assistant_created_at
  )
  RETURNING id INTO v_assistant_message_id;

  -- The returned profile, both message snapshots, and the replay cache share one
  -- transaction and therefore cannot expose divergent states after a rollback.
  v_response := p_response_payload || jsonb_build_object(
    'profile',
    CASE WHEN p_variant = 'personalized' THEN v_profile_snapshot ELSE NULL END,
    'messageId',
    v_assistant_message_id::text
  );

  UPDATE public.chat_request_deduplication
  SET status = 'completed',
      owner_token = NULL,
      response = v_response,
      user_message_id = v_user_message_id,
      assistant_message_id = v_assistant_message_id,
      lease_expires_at = NULL,
      dedupe_expires_at = clock_timestamp() + interval '10 seconds',
      updated_at = clock_timestamp()
  WHERE user_id = p_user_id
    AND request_hash = p_request_hash
    AND status = 'processing'
    AND owner_token = p_owner_token;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Chat request ownership changed during persistence'
      USING ERRCODE = '40001';
  END IF;

  RETURN QUERY SELECT
    v_user_message_id,
    v_assistant_message_id,
    v_response,
    'completed'::text;
END;
$$;

REVOKE ALL ON FUNCTION public.persist_chat_turn_idempotent_server(
  uuid, text, uuid, text, text, text, timestamptz, timestamptz, jsonb, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.persist_chat_turn_idempotent_server(
  uuid, text, uuid, text, text, text, timestamptz, timestamptz, jsonb, jsonb
) TO service_role;


-- AUD-04: bind every non-null memory source to a message owned by that same user.
-- The historic FK checked only messages(id), allowing memory_items.user_id and
-- source_message_id to form a cross-tenant pair. Clean such legacy poisoned rows
-- before adding the composite constraint, then make mismatches impossible at SQL level.
BEGIN;

LOCK TABLE public.messages IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.memory_items IN SHARE ROW EXCLUSIVE MODE;

DELETE FROM public.memory_items AS memory
USING public.messages AS source
WHERE source.id = memory.source_message_id
  AND source.user_id IS DISTINCT FROM memory.user_id;

-- A composite FK target must have an exact unique key, even though id alone is
-- already a primary key. Keeping this explicit makes tenant binding auditable.
CREATE UNIQUE INDEX IF NOT EXISTS messages_id_user_id_uidx
  ON public.messages (id, user_id);

ALTER TABLE public.memory_items
  DROP CONSTRAINT IF EXISTS memory_items_source_message_id_fkey;

ALTER TABLE public.memory_items
  DROP CONSTRAINT IF EXISTS memory_items_source_message_owner_fkey;

-- PostgreSQL checks (source_message_id,user_id) against (messages.id,user_id).
-- When a source message is deleted, clear only source_message_id; preserve the
-- memory's owning user_id so it never becomes NULL or changes tenant.
ALTER TABLE public.memory_items
  ADD CONSTRAINT memory_items_source_message_owner_fkey
  FOREIGN KEY (source_message_id, user_id)
  REFERENCES public.messages (id, user_id)
  ON DELETE SET NULL (source_message_id);

COMMIT;

CREATE INDEX IF NOT EXISTS memory_items_source_message_owner_idx
  ON public.memory_items (source_message_id, user_id);
-- AUD-05: keep memory vectors correctly dimensioned, finite-norm and non-zero.
ALTER TABLE public.memory_items
  DROP CONSTRAINT IF EXISTS memory_items_embedding_integrity_check;
ALTER TABLE public.memory_items
  ADD CONSTRAINT memory_items_embedding_integrity_check
  CHECK (
    extensions.vector_dims(embedding) = 384
    AND extensions.vector_norm(embedding) > 0
    AND extensions.vector_norm(embedding) < 'Infinity'::real
  ) NOT VALID;
ALTER TABLE public.memory_items
  VALIDATE CONSTRAINT memory_items_embedding_integrity_check;

-- AUD-06: completed chat responses are replay-cached for 10 seconds only.
-- The active processing lease remains five minutes to avoid duplicate concurrent
-- model inference while an original request is still running.
CREATE OR REPLACE FUNCTION public.set_chat_request_dedupe_window_10s()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
    NEW.dedupe_expires_at := clock_timestamp() + interval '10 seconds';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_chat_request_dedupe_window_10s() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_chat_request_dedupe_window_10s() TO service_role;

UPDATE public.chat_request_deduplication
SET dedupe_expires_at = LEAST(dedupe_expires_at, updated_at + interval '10 seconds')
WHERE status = 'completed';

DROP TRIGGER IF EXISTS chat_request_dedupe_window_10s ON public.chat_request_deduplication;
CREATE TRIGGER chat_request_dedupe_window_10s
BEFORE UPDATE OF status ON public.chat_request_deduplication
FOR EACH ROW
EXECUTE FUNCTION public.set_chat_request_dedupe_window_10s();

-- The complete clean-schema baseline includes the latest audited storage contract.
-- AUD-07: strengthen storage invariants and serialize chat persistence against data deletion.
-- Lock order for server chat state is: per-user advisory lock -> idempotency row
-- -> profile row/messages. The lock is transaction-scoped; it is never held
-- while calling an external model provider.
BEGIN;

-- A memory source must be both owned by the same user and a user-authored message.
-- FK enforcement remains effective even if a client bypasses application validation.
CREATE UNIQUE INDEX IF NOT EXISTS messages_id_user_role_uidx
  ON public.messages (id, user_id, role);

ALTER TABLE public.memory_items
  ADD COLUMN IF NOT EXISTS source_message_role text NOT NULL DEFAULT 'user';

DO $memory_role_check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.memory_items'::regclass
      AND conname = 'memory_items_source_message_role_check'
  ) THEN
    ALTER TABLE public.memory_items
      ADD CONSTRAINT memory_items_source_message_role_check
      CHECK (source_message_role = 'user');
  END IF;
END
$memory_role_check$;

-- Detach any historical memory that points at a same-owner assistant message.
UPDATE public.memory_items AS memory
SET source_message_id = NULL
WHERE memory.source_message_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.messages AS source
    WHERE source.id = memory.source_message_id
      AND source.user_id = memory.user_id
      AND source.role = 'user'
  );

ALTER TABLE public.memory_items
  DROP CONSTRAINT IF EXISTS memory_items_source_message_id_fkey;
ALTER TABLE public.memory_items
  DROP CONSTRAINT IF EXISTS memory_items_source_message_owner_fkey;

ALTER TABLE public.memory_items
  ADD CONSTRAINT memory_items_source_message_owner_fkey
  FOREIGN KEY (source_message_id, user_id, source_message_role)
  REFERENCES public.messages (id, user_id, role)
  ON DELETE SET NULL (source_message_id);

-- Replace the two-column Stage-6 index with its three-column equivalent. This
-- preserves the same index name while covering the stricter source-role FK.
DROP INDEX IF EXISTS public.memory_items_source_message_owner_idx;
CREATE INDEX memory_items_source_message_owner_idx
  ON public.memory_items (source_message_id, user_id, source_message_role);

-- Normalize every new/replaced vector within PostgreSQL itself, before CHECKs
-- and HNSW index maintenance. Query-time cosine behavior is unchanged.
CREATE OR REPLACE FUNCTION public.normalize_memory_embedding()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  embedding_norm double precision;
BEGIN
  IF NEW.embedding IS NULL OR extensions.vector_dims(NEW.embedding) <> 384 THEN
    RAISE EXCEPTION 'Memory embedding must have exactly 384 dimensions'
      USING ERRCODE = '23514';
  END IF;

  embedding_norm := extensions.vector_norm(NEW.embedding);
  IF embedding_norm IS NULL
     OR NOT (embedding_norm > 0 AND embedding_norm < 'Infinity'::double precision) THEN
    RAISE EXCEPTION 'Memory embedding must have a finite, non-zero norm'
      USING ERRCODE = '23514';
  END IF;

  NEW.embedding := extensions.l2_normalize(NEW.embedding);
  embedding_norm := extensions.vector_norm(NEW.embedding);

  IF embedding_norm IS NULL
     OR NOT (embedding_norm > 0 AND embedding_norm < 'Infinity'::double precision)
     OR abs(embedding_norm - 1.0) > 0.001 THEN
    RAISE EXCEPTION 'Memory embedding normalization failed'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.normalize_memory_embedding() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.normalize_memory_embedding() TO service_role;

DROP TRIGGER IF EXISTS normalize_memory_embedding_before_insert ON public.memory_items;
CREATE TRIGGER normalize_memory_embedding_before_insert
  BEFORE INSERT ON public.memory_items
  FOR EACH ROW
  EXECUTE FUNCTION public.normalize_memory_embedding();

DROP TRIGGER IF EXISTS normalize_memory_embedding_before_update ON public.memory_items;
CREATE TRIGGER normalize_memory_embedding_before_update
  BEFORE UPDATE OF embedding ON public.memory_items
  FOR EACH ROW
  EXECUTE FUNCTION public.normalize_memory_embedding();

-- Backfill only rows outside the accepted unit-norm tolerance; non-finite and
-- zero vectors are already rejected by the existing validated integrity CHECK.
UPDATE public.memory_items
SET embedding = extensions.l2_normalize(embedding)
WHERE abs(extensions.vector_norm(embedding) - 1.0) > 0.001;

ALTER TABLE public.memory_items
  ADD CONSTRAINT memory_items_embedding_unit_norm_check
  CHECK (abs(extensions.vector_norm(embedding) - 1.0) <= 0.001)
  NOT VALID;
ALTER TABLE public.memory_items
  VALIDATE CONSTRAINT memory_items_embedding_unit_norm_check;

-- One lock order is shared by claim, release, persist, and deletion. Expired-row
-- cleanup uses SKIP LOCKED to prevent concurrent GC batches waiting on each other.
CREATE OR REPLACE FUNCTION public.claim_chat_request_server(
  p_user_id uuid,
  p_request_hash text,
  p_owner_token uuid
)
RETURNS TABLE (
  disposition text,
  response jsonb,
  lease_expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_claimed_owner uuid;
  v_claimed_lease timestamptz;
  v_existing public.chat_request_deduplication%ROWTYPE;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'Server-only chat idempotency claim'
      USING ERRCODE = '42501';
  END IF;
  
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Chat request identity is required';
  END IF;
  -- Stable per-user transaction lock establishes one lock order shared with
  -- persistence and data deletion. Hash collisions only over-serialize users.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 0));

  IF p_user_id IS NULL OR p_owner_token IS NULL THEN
    RAISE EXCEPTION 'Chat request identity is required';
  END IF;

  IF p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid chat request hash';
  END IF;

  -- Opportunistic bounded cleanup prevents old response payloads from accumulating.
  -- Expired message fingerprints are metadata only; chat messages are not deleted here.
  -- Opportunistic bounded cleanup must never wait for a row held by an active
  -- request. Stable tie-breakers make batch selection deterministic.
  WITH stale_claims AS (
    SELECT candidate.user_id, candidate.request_hash
    FROM public.chat_request_deduplication AS candidate
    WHERE (
      candidate.status IN ('completed', 'failed')
      AND candidate.dedupe_expires_at <= clock_timestamp()
    ) OR (
      candidate.status = 'processing'
      AND candidate.lease_expires_at < clock_timestamp() - interval '1 hour'
    )
    ORDER BY candidate.updated_at, candidate.user_id, candidate.request_hash
    LIMIT 100
    FOR UPDATE SKIP LOCKED
  )
  DELETE FROM public.chat_request_deduplication AS expired
  USING stale_claims
  WHERE expired.user_id = stale_claims.user_id
    AND expired.request_hash = stale_claims.request_hash;

  INSERT INTO public.chat_request_deduplication (
    user_id, request_hash, status, owner_token, lease_expires_at,
    dedupe_expires_at, created_at, updated_at
  )
  VALUES (
    p_user_id, p_request_hash, 'processing', p_owner_token,
    clock_timestamp() + interval '5 minutes',
    clock_timestamp() + interval '5 minutes',
    clock_timestamp(), clock_timestamp()
  )
  ON CONFLICT (user_id, request_hash) DO UPDATE
    SET status = 'processing',
        owner_token = EXCLUDED.owner_token,
        response = NULL,
        user_message_id = NULL,
        assistant_message_id = NULL,
        lease_expires_at = EXCLUDED.lease_expires_at,
        dedupe_expires_at = EXCLUDED.dedupe_expires_at,
        created_at = clock_timestamp(),
        updated_at = clock_timestamp()
    WHERE public.chat_request_deduplication.status = 'failed'
       OR (
         public.chat_request_deduplication.status = 'processing'
         AND public.chat_request_deduplication.lease_expires_at <= clock_timestamp()
       )
       OR (
         public.chat_request_deduplication.status = 'completed'
         AND public.chat_request_deduplication.dedupe_expires_at <= clock_timestamp()
       )
  RETURNING owner_token, public.chat_request_deduplication.lease_expires_at
  INTO v_claimed_owner, v_claimed_lease;

  IF FOUND THEN
    RETURN QUERY SELECT 'claimed'::text, NULL::jsonb, v_claimed_lease;
    RETURN;
  END IF;

  SELECT *
  INTO v_existing
  FROM public.chat_request_deduplication
  WHERE user_id = p_user_id
    AND request_hash = p_request_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Chat request claim disappeared'
      USING ERRCODE = '40001';
  END IF;

  IF v_existing.status = 'completed'
     AND v_existing.dedupe_expires_at > clock_timestamp() THEN
    RETURN QUERY SELECT 'replay'::text, v_existing.response, v_existing.lease_expires_at;
    RETURN;
  END IF;

  IF v_existing.status = 'processing'
     AND v_existing.lease_expires_at > clock_timestamp() THEN
    RETURN QUERY SELECT 'in_progress'::text, NULL::jsonb, v_existing.lease_expires_at;
    RETURN;
  END IF;

  RAISE EXCEPTION 'Chat request claim must be retried'
    USING ERRCODE = '40001';
END;
$$;

CREATE OR REPLACE FUNCTION public.release_chat_request_server(
  p_user_id uuid,
  p_request_hash text,
  p_owner_token uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'Server-only chat idempotency release'
      USING ERRCODE = '42501';
  END IF;
  
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Chat request identity is required';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 0));

  UPDATE public.chat_request_deduplication
  SET status = 'failed',
      owner_token = NULL,
      response = NULL,
      user_message_id = NULL,
      assistant_message_id = NULL,
      lease_expires_at = NULL,
      dedupe_expires_at = clock_timestamp(),
      updated_at = clock_timestamp()
  WHERE user_id = p_user_id
    AND request_hash = p_request_hash
    AND status = 'processing'
    AND owner_token = p_owner_token;
END;
$$;

CREATE OR REPLACE FUNCTION public.persist_chat_turn_idempotent_server(
  p_user_id uuid,
  p_request_hash text,
  p_owner_token uuid,
  p_variant text,
  p_user_content text,
  p_assistant_content text,
  p_user_created_at timestamptz,
  p_assistant_created_at timestamptz,
  p_profile_snapshot jsonb,
  p_response_payload jsonb
)
RETURNS TABLE (
  user_message_id uuid,
  assistant_message_id uuid,
  response jsonb,
  disposition text
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_claim public.chat_request_deduplication%ROWTYPE;
  v_user_message_id uuid;
  v_assistant_message_id uuid;
  v_profile_snapshot jsonb;
  v_response jsonb;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'Server-only idempotent chat writer'
      USING ERRCODE = '42501';
  END IF;
  
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Chat request identity is required';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 0));

  IF p_user_id IS NULL OR p_owner_token IS NULL THEN
    RAISE EXCEPTION 'Chat request identity is required';
  END IF;

  IF p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid chat request hash';
  END IF;

  SELECT *
  INTO v_claim
  FROM public.chat_request_deduplication
  WHERE user_id = p_user_id
    AND request_hash = p_request_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Chat request was not claimed';
  END IF;

  IF v_claim.status = 'completed' THEN
    RETURN QUERY SELECT
      v_claim.user_message_id,
      v_claim.assistant_message_id,
      v_claim.response,
      'replay'::text;
    RETURN;
  END IF;

  IF v_claim.status <> 'processing'
     OR v_claim.owner_token IS DISTINCT FROM p_owner_token THEN
    RAISE EXCEPTION 'Chat request claim is not owned by this worker'
      USING ERRCODE = '40001';
  END IF;

  IF p_variant IS NULL OR p_variant NOT IN ('personalized', 'baseline') THEN
    RAISE EXCEPTION 'Invalid chat variant';
  END IF;

  IF p_user_content IS NULL OR char_length(p_user_content) NOT BETWEEN 1 AND 4000 THEN
    RAISE EXCEPTION 'Invalid user message';
  END IF;

  IF p_assistant_content IS NULL OR char_length(p_assistant_content) NOT BETWEEN 1 AND 4000 THEN
    RAISE EXCEPTION 'Invalid assistant message';
  END IF;

  IF p_user_created_at IS NULL
     OR p_assistant_created_at IS NULL
     OR p_assistant_created_at <= p_user_created_at THEN
    RAISE EXCEPTION 'Invalid chat timestamps';
  END IF;

  IF jsonb_typeof(p_response_payload) IS DISTINCT FROM 'object'
     OR COALESCE(p_response_payload ->> 'reply', '') = ''
     OR p_response_payload ->> 'variant' IS DISTINCT FROM p_variant THEN
    RAISE EXCEPTION 'Invalid cached chat response';
  END IF;

  IF p_variant = 'personalized' THEN
    IF p_profile_snapshot IS NULL
       OR jsonb_typeof(p_profile_snapshot) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'Personalized chat requires a profile observation';
    END IF;

    IF (SELECT count(*) FROM jsonb_object_keys(p_profile_snapshot)) <> 13
       OR EXISTS (
         SELECT 1
         FROM jsonb_each(p_profile_snapshot) AS item(key, value)
         WHERE NOT (item.key = ANY (ARRAY[
           'valence', 'arousal', 'dominance', 'openness',
           'conscientiousness', 'extraversion', 'agreeableness',
           'neuroticism', 'informality', 'emoji_frequency',
           'humor', 'slang', 'avg_sentence_length'
         ]::text[]))
         OR NOT (
           CASE
             WHEN jsonb_typeof(item.value) = 'number'
               THEN (item.value #>> '{}')::numeric BETWEEN 0 AND 1
             ELSE false
           END
         )
       ) THEN
      RAISE EXCEPTION 'Invalid profile observation payload';
    END IF;

    -- PostgreSQL serializes concurrent inserts/updates on the unique user_id row.
    -- Crucially, the UPDATE combines EXCLUDED observation with the locked row instead
    -- of assigning EXCLUDED.profile directly, so concurrent traits cannot be lost.
    INSERT INTO public.twin_profiles (user_id, profile, updated_at)
    VALUES (p_user_id, p_profile_snapshot, clock_timestamp())
    ON CONFLICT (user_id) DO UPDATE
      SET profile = public.merge_twin_profile_observation(
            twin_profiles.profile,
            EXCLUDED.profile
          ),
          updated_at = clock_timestamp()
    RETURNING profile INTO v_profile_snapshot;
  ELSIF p_profile_snapshot IS NOT NULL THEN
    RAISE EXCEPTION 'Baseline chat cannot persist a profile observation';
  END IF;

  INSERT INTO public.messages (
    user_id, role, variant, content, profile_snapshot, created_at
  )
  VALUES (
    p_user_id, 'user', p_variant, p_user_content, v_profile_snapshot, p_user_created_at
  )
  RETURNING id INTO v_user_message_id;

  INSERT INTO public.messages (
    user_id, role, variant, content, profile_snapshot, created_at
  )
  VALUES (
    p_user_id, 'assistant', p_variant, p_assistant_content, v_profile_snapshot, p_assistant_created_at
  )
  RETURNING id INTO v_assistant_message_id;

  -- The returned profile, both message snapshots, and the replay cache share one
  -- transaction and therefore cannot expose divergent states after a rollback.
  v_response := p_response_payload || jsonb_build_object(
    'profile',
    CASE WHEN p_variant = 'personalized' THEN v_profile_snapshot ELSE NULL END,
    'messageId',
    v_assistant_message_id::text
  );

  UPDATE public.chat_request_deduplication
  SET status = 'completed',
      owner_token = NULL,
      response = v_response,
      user_message_id = v_user_message_id,
      assistant_message_id = v_assistant_message_id,
      lease_expires_at = NULL,
      dedupe_expires_at = clock_timestamp() + interval '10 seconds',
      updated_at = clock_timestamp()
  WHERE user_id = p_user_id
    AND request_hash = p_request_hash
    AND status = 'processing'
    AND owner_token = p_owner_token;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Chat request ownership changed during persistence'
      USING ERRCODE = '40001';
  END IF;

  RETURN QUERY SELECT
    v_user_message_id,
    v_assistant_message_id,
    v_response,
    'completed'::text;
END;
$$;

-- This RPC invalidates in-flight claims before deleting chat rows, so a delayed
-- model response cannot recreate records after the user has requested deletion.
CREATE OR REPLACE FUNCTION public.delete_my_chat_data_server(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  deleted_memories integer := 0;
  deleted_profiles integer := 0;
  deleted_messages integer := 0;
  deleted_claims integer := 0;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'Server-only user-data deletion'
      USING ERRCODE = '42501';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'User identity is required';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 0));

  DELETE FROM public.chat_request_deduplication WHERE user_id = p_user_id;
  GET DIAGNOSTICS deleted_claims = ROW_COUNT;

  DELETE FROM public.memory_items WHERE user_id = p_user_id;
  GET DIAGNOSTICS deleted_memories = ROW_COUNT;

  DELETE FROM public.twin_profiles WHERE user_id = p_user_id;
  GET DIAGNOSTICS deleted_profiles = ROW_COUNT;

  DELETE FROM public.messages WHERE user_id = p_user_id;
  GET DIAGNOSTICS deleted_messages = ROW_COUNT;

  RETURN jsonb_build_object(
    'memories_deleted', deleted_memories,
    'profiles_deleted', deleted_profiles,
    'messages_deleted', deleted_messages,
    'chat_claims_deleted', deleted_claims
  );
END;
$$;

-- Privileges on DELETE are not inherited from BYPASSRLS; grant only the server role.
GRANT DELETE ON TABLE public.memory_items, public.twin_profiles, public.messages TO service_role;
REVOKE ALL ON FUNCTION public.delete_my_chat_data() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_my_chat_data_server(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_my_chat_data_server(uuid) TO service_role;

COMMIT;
