-- Production rate limiting backed by the existing Supabase database.
-- This removes the need for a separate Redis account when Upstash is not configured.
-- Only service_role may call the RPC or access counter rows; the function is SECURITY INVOKER.

CREATE TABLE IF NOT EXISTS public.chat_rate_limit_counters (
  scope text NOT NULL CHECK (scope IN ('user', 'global-minute', 'global-day')),
  subject_hash text NOT NULL CHECK (char_length(subject_hash) BETWEEN 1 AND 64),
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  request_count integer NOT NULL CHECK (request_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, subject_hash, window_start),
  CHECK (window_end > window_start)
);

ALTER TABLE public.chat_rate_limit_counters ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.chat_rate_limit_counters FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.chat_rate_limit_counters TO service_role;

CREATE INDEX IF NOT EXISTS chat_rate_limit_counters_window_end_idx
  ON public.chat_rate_limit_counters (window_end);

CREATE OR REPLACE FUNCTION public.consume_chat_rate_limit(
  p_user_digest text,
  p_now timestamptz
)
RETURNS TABLE (
  allowed boolean,
  retry_after_seconds integer,
  reason text
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_now timestamptz := p_now;
  v_minute_start timestamptz;
  v_minute_end timestamptz;
  v_day_start timestamptz;
  v_day_end timestamptz;
  v_user_count integer := 0;
  v_global_minute_count integer := 0;
  v_global_day_count integer := 0;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'Server-only rate limiter' USING ERRCODE = '42501';
  END IF;

  IF p_user_digest IS NULL OR p_user_digest !~ '^[0-9a-f]{64}$' OR v_now IS NULL THEN
    RAISE EXCEPTION 'Invalid rate-limit request';
  END IF;

  v_minute_start := date_trunc('minute', v_now);
  v_minute_end := v_minute_start + interval '1 minute';
  v_day_start := date_trunc('day', v_now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_day_end := v_day_start + interval '1 day';

  -- One transaction-scoped lock makes quota checking and all three increments atomic.
  PERFORM pg_advisory_xact_lock(1279591508, 1);

  DELETE FROM public.chat_rate_limit_counters
  WHERE window_end < v_now - interval '2 days';

  SELECT coalesce(max(request_count), 0)
    INTO v_user_count
  FROM public.chat_rate_limit_counters
  WHERE scope = 'user'
    AND subject_hash = p_user_digest
    AND window_start = v_minute_start;

  SELECT coalesce(max(request_count), 0)
    INTO v_global_minute_count
  FROM public.chat_rate_limit_counters
  WHERE scope = 'global-minute'
    AND subject_hash = 'global'
    AND window_start = v_minute_start;

  SELECT coalesce(max(request_count), 0)
    INTO v_global_day_count
  FROM public.chat_rate_limit_counters
  WHERE scope = 'global-day'
    AND subject_hash = 'global'
    AND window_start = v_day_start;

  IF v_user_count >= 20 THEN
    RETURN QUERY SELECT false, greatest(1, ceil(extract(epoch FROM v_minute_end - v_now))::integer), 'user'::text;
    RETURN;
  END IF;

  IF v_global_minute_count >= 120 THEN
    RETURN QUERY SELECT false, greatest(1, ceil(extract(epoch FROM v_minute_end - v_now))::integer), 'global-minute'::text;
    RETURN;
  END IF;

  IF v_global_day_count >= 1000 THEN
    RETURN QUERY SELECT false, greatest(1, ceil(extract(epoch FROM v_day_end - v_now))::integer), 'global-day'::text;
    RETURN;
  END IF;

  INSERT INTO public.chat_rate_limit_counters (scope, subject_hash, window_start, window_end, request_count, updated_at)
  VALUES ('user', p_user_digest, v_minute_start, v_minute_end, 1, v_now)
  ON CONFLICT (scope, subject_hash, window_start)
  DO UPDATE SET request_count = public.chat_rate_limit_counters.request_count + 1,
                updated_at = EXCLUDED.updated_at;

  INSERT INTO public.chat_rate_limit_counters (scope, subject_hash, window_start, window_end, request_count, updated_at)
  VALUES ('global-minute', 'global', v_minute_start, v_minute_end, 1, v_now)
  ON CONFLICT (scope, subject_hash, window_start)
  DO UPDATE SET request_count = public.chat_rate_limit_counters.request_count + 1,
                updated_at = EXCLUDED.updated_at;

  INSERT INTO public.chat_rate_limit_counters (scope, subject_hash, window_start, window_end, request_count, updated_at)
  VALUES ('global-day', 'global', v_day_start, v_day_end, 1, v_now)
  ON CONFLICT (scope, subject_hash, window_start)
  DO UPDATE SET request_count = public.chat_rate_limit_counters.request_count + 1,
                updated_at = EXCLUDED.updated_at;

  RETURN QUERY SELECT true, 0, 'allowed'::text;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_chat_rate_limit(text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_chat_rate_limit(text, timestamptz) TO service_role;
