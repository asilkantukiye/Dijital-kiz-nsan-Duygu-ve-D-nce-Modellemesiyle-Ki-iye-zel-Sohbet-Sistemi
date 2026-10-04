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
  content text not null,
  profile_snapshot jsonb,
  created_at timestamptz not null default now()
);

alter table public.twin_profiles enable row level security;
alter table public.messages enable row level security;

drop policy if exists "users own twin profile" on public.twin_profiles;
create policy "users own twin profile" on public.twin_profiles for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "users own messages" on public.messages;
create policy "users own messages" on public.messages for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists messages_user_created_idx on public.messages(user_id, created_at desc);
