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
