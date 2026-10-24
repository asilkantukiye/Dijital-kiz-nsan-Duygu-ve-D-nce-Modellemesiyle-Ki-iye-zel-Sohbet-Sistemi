-- AUD-06: expire completed-response replay cache after ten seconds.
-- Keep the five-minute processing lease intact to prevent duplicate concurrent
-- inference. Triggered expiry applies atomically with the completed state change.
BEGIN;

CREATE OR REPLACE FUNCTION public.set_chat_request_dedupe_window_10s()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
    NEW.dedupe_expires_at := clock_timestamp() + interval '10 seconds';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_chat_request_dedupe_window_10s() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_chat_request_dedupe_window_10s() TO service_role;

-- Existing completed requests are bounded by their original completion time,
-- not by migration deployment time.
UPDATE public.chat_request_deduplication
SET dedupe_expires_at = LEAST(dedupe_expires_at, updated_at + interval '10 seconds')
WHERE status = 'completed';

DROP TRIGGER IF EXISTS chat_request_dedupe_window_10s ON public.chat_request_deduplication;
CREATE TRIGGER chat_request_dedupe_window_10s
BEFORE UPDATE OF status ON public.chat_request_deduplication
FOR EACH ROW
EXECUTE FUNCTION public.set_chat_request_dedupe_window_10s();

COMMIT;
