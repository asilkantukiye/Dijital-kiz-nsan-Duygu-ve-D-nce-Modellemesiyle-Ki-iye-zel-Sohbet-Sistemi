create extension if not exists pgcrypto;
create extension if not exists vector;

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

drop policy if exists "users own feedback" on public.message_feedback;
create policy "users own feedback"
  on public.message_feedback
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

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
