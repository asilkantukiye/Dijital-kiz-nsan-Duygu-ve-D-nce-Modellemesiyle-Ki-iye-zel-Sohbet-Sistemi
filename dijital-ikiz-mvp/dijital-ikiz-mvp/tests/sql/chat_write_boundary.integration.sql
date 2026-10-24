\set ON_ERROR_STOP on

-- After persist_chat_turn.integration.sql, verify an authenticated JWT cannot
-- write chat/profile records directly or invoke either writer RPC.
RESET ROLE;
SET ROLE authenticated;
SET request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';

DO $chat_write_boundary$
DECLARE
  rejected boolean;
BEGIN
  IF has_table_privilege('authenticated', 'public.messages', 'INSERT')
     OR has_table_privilege('authenticated', 'public.messages', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.twin_profiles', 'INSERT')
     OR has_table_privilege('authenticated', 'public.twin_profiles', 'UPDATE') THEN
    RAISE EXCEPTION 'authenticated retains direct chat/profile write privilege';
  END IF;

  IF has_function_privilege(
    'authenticated',
    'public.persist_chat_turn(text,text,text,timestamptz,timestamptz,jsonb)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated can still execute legacy chat writer RPC';
  END IF;

  IF has_function_privilege(
    'authenticated',
    'public.persist_chat_turn_server(uuid,text,text,text,timestamptz,timestamptz,jsonb)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated can execute server-only chat writer RPC';
  END IF;

  IF NOT has_function_privilege(
    'service_role',
    'public.persist_chat_turn_server(uuid,text,text,text,timestamptz,timestamptz,jsonb)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'service_role cannot execute server-only chat writer RPC';
  END IF;

  rejected := false;
  BEGIN
    INSERT INTO public.messages (user_id, role, variant, content)
    VALUES (auth.uid(), 'assistant', 'baseline', 'forged assistant row');
  EXCEPTION WHEN insufficient_privilege THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'authenticated direct assistant insert unexpectedly succeeded';
  END IF;

  rejected := false;
  BEGIN
    UPDATE public.messages
       SET content = 'forged content'
     WHERE user_id = auth.uid();
  EXCEPTION WHEN insufficient_privilege THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'authenticated direct message update unexpectedly succeeded';
  END IF;

  rejected := false;
  BEGIN
    INSERT INTO public.twin_profiles (user_id, profile)
    VALUES (auth.uid(), '{"forged":true}'::jsonb)
    ON CONFLICT (user_id) DO UPDATE SET profile = EXCLUDED.profile;
  EXCEPTION WHEN insufficient_privilege THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'authenticated direct profile write unexpectedly succeeded';
  END IF;

  rejected := false;
  BEGIN
    PERFORM * FROM public.persist_chat_turn(
      'baseline', 'user text', 'forged assistant text',
      now(), now() + interval '1 millisecond', NULL
    );
  EXCEPTION WHEN insufficient_privilege THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'authenticated legacy writer RPC unexpectedly succeeded';
  END IF;

  rejected := false;
  BEGIN
    PERFORM * FROM public.persist_chat_turn_server(
      auth.uid(), 'baseline', 'user text', 'forged assistant text',
      now(), now() + interval '1 millisecond', NULL
    );
  EXCEPTION WHEN insufficient_privilege THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'authenticated server-only writer RPC unexpectedly succeeded';
  END IF;
END
$chat_write_boundary$;

RESET ROLE;
