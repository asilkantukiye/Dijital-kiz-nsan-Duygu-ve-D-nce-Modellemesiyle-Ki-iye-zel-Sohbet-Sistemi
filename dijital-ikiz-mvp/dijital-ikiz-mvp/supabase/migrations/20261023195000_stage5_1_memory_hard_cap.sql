-- Stage 5.1: enforce the per-account memory row cap at the database boundary.
-- RLS remains active: this function is SECURITY INVOKER and only prunes the
-- row owner's partition. The trigger runs before RLS WITH CHECK, so a foreign
-- user_id must not trigger cleanup for that other user's rows.
create index if not exists memory_items_user_updated_cap_idx
  on public.memory_items (user_id, updated_at desc, id asc);

create or replace function public.enforce_memory_item_cap_before_insert()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
begin
  -- Let RLS reject a mismatched owner after the trigger returns, but do not
  -- mutate any memory rows when an authenticated caller supplied a foreign ID.
  if v_actor is null or new.user_id is distinct from v_actor then
    return new;
  end if;

  -- INSERT .. ON CONFLICT for an existing record does not increase the row
  -- count. Avoid pruning for that case; ordinary new inserts below are capped.
  if exists (
    select 1 from public.memory_items
    where user_id = new.user_id and content = new.content
  ) then
    return new;
  end if;

  -- Serialize inserts for this account to avoid concurrent requests both
  -- observing 49 rows and inserting a 51st row. Lock is transaction-scoped.
  perform pg_advisory_xact_lock(
    hashtextextended(new.user_id::text || ':memory-cap', 0)
  );

  -- Leave at most 49 old rows before allowing this new row to be inserted.
  -- When the account is already over cap this also deletes the existing
  -- overflow, using the same updated_at/id ordering as the application layer.
  with overflow as (
    select id
      from public.memory_items
     where user_id = new.user_id
     order by updated_at desc, id asc
     offset 49
  )
  delete from public.memory_items as memory
   using overflow
   where memory.id = overflow.id
     and memory.user_id = new.user_id;

  return new;
end;
$$;

drop trigger if exists memory_items_cap_before_insert on public.memory_items;
create trigger memory_items_cap_before_insert
before insert on public.memory_items
for each row execute function public.enforce_memory_item_cap_before_insert();

-- This helper is intended only to be invoked by the trigger.
revoke all on function public.enforce_memory_item_cap_before_insert() from public;
revoke all on function public.enforce_memory_item_cap_before_insert() from anon;
revoke all on function public.enforce_memory_item_cap_before_insert() from authenticated;
