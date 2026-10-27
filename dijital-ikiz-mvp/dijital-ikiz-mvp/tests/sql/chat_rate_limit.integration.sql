\set ON_ERROR_STOP on

DO $rate_limit_catalog$
BEGIN
  IF to_regclass('public.chat_rate_limit_counters') IS NULL THEN
    RAISE EXCEPTION 'chat_rate_limit_counters table is missing';
  END IF;

  IF NOT (
    SELECT relrowsecurity
    FROM pg_class
    WHERE oid = 'public.chat_rate_limit_counters'::regclass
  ) THEN
    RAISE EXCEPTION 'chat_rate_limit_counters must have RLS enabled';
  END IF;

  IF has_table_privilege('anon', 'public.chat_rate_limit_counters', 'SELECT')
     OR has_table_privilege('anon', 'public.chat_rate_limit_counters', 'INSERT')
     OR has_table_privilege('authenticated', 'public.chat_rate_limit_counters', 'SELECT')
     OR has_table_privilege('authenticated', 'public.chat_rate_limit_counters', 'INSERT') THEN
    RAISE EXCEPTION 'API roles unexpectedly have direct rate-limit table access';
  END IF;

  IF NOT has_table_privilege('service_role', 'public.chat_rate_limit_counters', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.chat_rate_limit_counters', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.chat_rate_limit_counters', 'UPDATE')
     OR NOT has_table_privilege('service_role', 'public.chat_rate_limit_counters', 'DELETE') THEN
    RAISE EXCEPTION 'service_role is missing required rate-limit table privileges';
  END IF;

  IF has_function_privilege('anon', 'public.consume_chat_rate_limit(text,timestamptz)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.consume_chat_rate_limit(text,timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'API roles unexpectedly can execute the server-only rate limiter';
  END IF;

  IF NOT has_function_privilege('service_role', 'public.consume_chat_rate_limit(text,timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role cannot execute the rate limiter';
  END IF;

  IF (SELECT prosecdef FROM pg_proc WHERE oid = 'public.consume_chat_rate_limit(text,timestamptz)'::regprocedure) THEN
    RAISE EXCEPTION 'rate limiter must remain SECURITY INVOKER';
  END IF;
END
$rate_limit_catalog$;

BEGIN;

-- Quota decisions use deterministic windows so cap tests are repeatable.
SET ROLE service_role;
DO $rate_limit_behaviour$
DECLARE
  decision record;
  test_now timestamptz := '2026-10-27T18:00:00Z'::timestamptz;
  index integer;
BEGIN
  FOR index IN 1..20 LOOP
    SELECT * INTO decision
    FROM public.consume_chat_rate_limit(lpad(to_hex(1000 + index), 64, '0'), test_now);
    IF decision.allowed IS DISTINCT FROM true OR decision.reason IS DISTINCT FROM 'allowed' THEN
      RAISE EXCEPTION 'initial request % unexpectedly denied: %', index, decision.reason;
    END IF;
  END LOOP;

  FOR index IN 1..20 LOOP
    SELECT * INTO decision
    FROM public.consume_chat_rate_limit(repeat('a', 64), test_now);
    IF decision.allowed IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'same-user request % unexpectedly denied: %', index, decision.reason;
    END IF;
  END LOOP;
  SELECT * INTO decision FROM public.consume_chat_rate_limit(repeat('a', 64), test_now);
  IF decision.allowed IS DISTINCT FROM false OR decision.reason IS DISTINCT FROM 'user' THEN
    RAISE EXCEPTION 'per-user limit did not block request 21';
  END IF;

  FOR index IN 1..80 LOOP
    SELECT * INTO decision
    FROM public.consume_chat_rate_limit(lpad(to_hex(2000 + index), 64, '0'), test_now);
    IF decision.allowed IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'global-minute request % unexpectedly denied: %', index, decision.reason;
    END IF;
  END LOOP;
  SELECT * INTO decision FROM public.consume_chat_rate_limit(repeat('b', 64), test_now);
  IF decision.allowed IS DISTINCT FROM false OR decision.reason IS DISTINCT FROM 'global-minute' THEN
    RAISE EXCEPTION 'global-minute limit did not block request 121';
  END IF;
END
$rate_limit_behaviour$;
RESET ROLE;

-- Preload a daily bucket at its cap, then verify the RPC blocks before consuming.
INSERT INTO public.chat_rate_limit_counters
  (scope, subject_hash, window_start, window_end, request_count, updated_at)
VALUES (
  'global-day', 'global', '2026-10-27T00:00:00Z'::timestamptz,
  '2026-10-28T00:00:00Z'::timestamptz, 1000, now()
)
ON CONFLICT (scope, subject_hash, window_start)
DO UPDATE SET request_count = 1000, window_end = EXCLUDED.window_end;

SET ROLE service_role;
DO $rate_limit_daily$
DECLARE
  decision record;
BEGIN
  SELECT * INTO decision
  FROM public.consume_chat_rate_limit(repeat('c', 64), '2026-10-27T18:01:00Z'::timestamptz);
  IF decision.allowed IS DISTINCT FROM false OR decision.reason IS DISTINCT FROM 'global-day' THEN
    RAISE EXCEPTION 'global-day limit did not block request 1001';
  END IF;
END
$rate_limit_daily$;
RESET ROLE;

ROLLBACK;
