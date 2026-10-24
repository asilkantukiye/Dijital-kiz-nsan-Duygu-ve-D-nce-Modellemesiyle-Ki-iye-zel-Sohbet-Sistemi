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
