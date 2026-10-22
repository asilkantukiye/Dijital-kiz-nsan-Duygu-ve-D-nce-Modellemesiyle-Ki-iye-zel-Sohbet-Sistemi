-- Update one preference and remove stale same-topic rows atomically.
-- SECURITY INVOKER preserves table grants and the memory_items RLS policy.
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
