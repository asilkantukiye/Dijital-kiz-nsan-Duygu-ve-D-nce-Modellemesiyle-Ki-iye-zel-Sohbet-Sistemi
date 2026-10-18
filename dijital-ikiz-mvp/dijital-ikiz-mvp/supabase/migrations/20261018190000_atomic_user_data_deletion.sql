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
