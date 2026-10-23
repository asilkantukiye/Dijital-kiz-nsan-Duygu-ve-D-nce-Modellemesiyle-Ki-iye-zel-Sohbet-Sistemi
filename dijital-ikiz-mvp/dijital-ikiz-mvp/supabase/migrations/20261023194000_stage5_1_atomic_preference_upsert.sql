-- Stage 5.1: serialize explicit preference writes for each authenticated user.
-- Existing preference rows are backfilled on first matching write; using a
-- nullable key preserves existing data while the application gradually upgrades.
alter table public.memory_items
  add column if not exists preference_key text;

alter table public.memory_items
  drop constraint if exists memory_items_preference_key_length_check;

alter table public.memory_items
  add constraint memory_items_preference_key_length_check
  check (preference_key is null or char_length(preference_key) between 1 and 240);

create unique index if not exists memory_items_user_preference_key_uidx
  on public.memory_items (user_id, preference_key)
  where memory_type = 'preference' and preference_key is not null;

create or replace function public.upsert_my_memory_preference(
  p_preference_key text,
  p_keep_id uuid,
  p_duplicate_ids uuid[],
  p_content text,
  p_importance real,
  p_embedding extensions.vector(384),
  p_source_message_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog, public, extensions
as $$
declare
  v_user_id uuid := auth.uid();
  v_target_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_preference_key is null
     or char_length(p_preference_key) not between 1 and 240
     or p_content is null
     or char_length(p_content) not between 2 and 240
     or p_importance is null
     or p_importance not between 0 and 1
     or p_embedding is null
     or p_source_message_id is null then
    raise exception 'Invalid preference upsert payload';
  end if;

  -- The transaction-scoped lock serializes *all* preference writes by this
  -- user, including first insert. Hash collisions only cause extra waiting;
  -- they do not permit cross-user data access because RLS/auth.uid still apply.
  perform pg_advisory_xact_lock(
    hashtextextended(v_user_id::text || ':memory-preference', 0)
  );

  -- Every caller re-checks the canonical conflict key after acquiring the
  -- lock, not just the candidate list fetched by application code beforehand.
  select id
    into v_target_id
    from public.memory_items
   where user_id = v_user_id
     and memory_type = 'preference'
     and preference_key = p_preference_key
   for update;

  if v_target_id is null and p_keep_id is not null then
    -- Migrate one matching legacy row in place when the application identified
    -- a conflict before the lock. The owner and type predicate are mandatory.
    update public.memory_items
       set content = p_content,
           importance = p_importance,
           embedding = p_embedding,
           source_message_id = p_source_message_id,
           preference_key = p_preference_key,
           updated_at = now()
     where id = p_keep_id
       and user_id = v_user_id
       and memory_type = 'preference'
    returning id into v_target_id;
  end if;

  if v_target_id is null then
    insert into public.memory_items (
      user_id, memory_type, content, importance, embedding,
      source_message_id, preference_key, updated_at
    )
    values (
      v_user_id, 'preference', p_content, p_importance, p_embedding,
      p_source_message_id, p_preference_key, now()
    )
    returning id into v_target_id;
  else
    update public.memory_items
       set content = p_content,
           importance = p_importance,
           embedding = p_embedding,
           source_message_id = p_source_message_id,
           preference_key = p_preference_key,
           updated_at = now()
     where id = v_target_id
       and user_id = v_user_id
       and memory_type = 'preference';
  end if;

  -- The lock prevents two new code paths racing between "not found" and insert.
  -- The key predicate also removes conflicts created by a parallel request;
  -- duplicate IDs are supplemental legacy cleanup candidates, never authority
  -- to delete a different user's row.
  delete from public.memory_items
   where user_id = v_user_id
     and memory_type = 'preference'
     and id <> v_target_id
     and (
       preference_key = p_preference_key
       or id = any(coalesce(p_duplicate_ids, array[]::uuid[]))
     );

  -- A source message must be the same user's stored user turn, preventing
  -- malformed clients from attaching another user's message as provenance.
  if not exists (
    select 1
      from public.messages
     where id = p_source_message_id
       and user_id = v_user_id
       and role = 'user'
  ) then
    raise exception 'Preference source message not found';
  end if;

  return v_target_id;
end;
$$;

revoke all on function public.upsert_my_memory_preference(
  text, uuid, uuid[], text, real, extensions.vector(384), uuid
) from public;
revoke all on function public.upsert_my_memory_preference(
  text, uuid, uuid[], text, real, extensions.vector(384), uuid
) from anon;
grant execute on function public.upsert_my_memory_preference(
  text, uuid, uuid[], text, real, extensions.vector(384), uuid
) to authenticated;
