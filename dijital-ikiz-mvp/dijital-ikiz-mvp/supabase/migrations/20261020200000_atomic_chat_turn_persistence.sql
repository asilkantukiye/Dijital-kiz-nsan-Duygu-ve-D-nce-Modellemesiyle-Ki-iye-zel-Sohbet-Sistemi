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
