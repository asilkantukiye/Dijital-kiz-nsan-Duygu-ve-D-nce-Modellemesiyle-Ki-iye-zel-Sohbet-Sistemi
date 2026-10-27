-- Correct Stage 6 retention to match the published privacy policy:
-- expire memory only after 180 days of inactivity; preserve chat history until user deletion.

DROP INDEX IF EXISTS public.messages_retention_created_at_idx;
DROP INDEX IF EXISTS public.memory_items_retention_created_at_idx;

CREATE INDEX IF NOT EXISTS memory_items_retention_updated_at_idx
  ON public.memory_items (updated_at);

DROP FUNCTION IF EXISTS public.purge_expired_user_content();

CREATE FUNCTION public.purge_expired_user_content()
RETURNS TABLE (
  memory_items_deleted bigint,
  dedupe_deleted bigint,
  rate_limit_deleted bigint,
  backlog_remaining boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $retention$
DECLARE
  v_cutoff timestamptz := statement_timestamp() - interval '180 days';
  v_short_cutoff timestamptz := statement_timestamp() - interval '2 days';
  v_now timestamptz := statement_timestamp();
  v_rows integer;
  v_batch integer;
  v_memory_items_deleted bigint := 0;
  v_dedupe_deleted bigint := 0;
  v_rate_limit_deleted bigint := 0;
BEGIN
  IF NOT pg_try_advisory_xact_lock(1279591508, 3) THEN
    RETURN QUERY SELECT 0::bigint, 0::bigint, 0::bigint, true;
    RETURN;
  END IF;

  FOR v_batch IN 1..20 LOOP
    DELETE FROM public.memory_items AS memory
    WHERE memory.id IN (
      SELECT candidate.id
      FROM public.memory_items AS candidate
      WHERE candidate.updated_at < v_cutoff
        AND (candidate.last_used_at IS NULL OR candidate.last_used_at < v_cutoff)
      ORDER BY candidate.updated_at
      LIMIT 1000
    );
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_memory_items_deleted := v_memory_items_deleted + v_rows;
    EXIT WHEN v_rows < 1000;
  END LOOP;

  FOR v_batch IN 1..20 LOOP
    DELETE FROM public.chat_request_deduplication AS expired
    WHERE (expired.user_id, expired.request_hash) IN (
      SELECT candidate.user_id, candidate.request_hash
      FROM public.chat_request_deduplication AS candidate
      WHERE (
        candidate.status IN ('completed', 'failed')
        AND candidate.dedupe_expires_at <= v_now
      ) OR (
        candidate.status = 'processing'
        AND candidate.lease_expires_at < v_now - interval '1 hour'
      )
      ORDER BY candidate.updated_at
      LIMIT 1000
    );
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_dedupe_deleted := v_dedupe_deleted + v_rows;
    EXIT WHEN v_rows < 1000;
  END LOOP;

  FOR v_batch IN 1..20 LOOP
    DELETE FROM public.chat_rate_limit_counters AS counter
    WHERE (counter.scope, counter.subject_hash, counter.window_start) IN (
      SELECT candidate.scope, candidate.subject_hash, candidate.window_start
      FROM public.chat_rate_limit_counters AS candidate
      WHERE candidate.window_end < v_short_cutoff
      ORDER BY candidate.window_end
      LIMIT 1000
    );
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_rate_limit_deleted := v_rate_limit_deleted + v_rows;
    EXIT WHEN v_rows < 1000;
  END LOOP;

  RETURN QUERY
  SELECT
    v_memory_items_deleted,
    v_dedupe_deleted,
    v_rate_limit_deleted,
    (
      EXISTS (
        SELECT 1 FROM public.memory_items
        WHERE updated_at < v_cutoff
          AND (last_used_at IS NULL OR last_used_at < v_cutoff)
      )
      OR EXISTS (
        SELECT 1 FROM public.chat_request_deduplication
        WHERE (status IN ('completed', 'failed') AND dedupe_expires_at <= v_now)
           OR (status = 'processing' AND lease_expires_at < v_now - interval '1 hour')
      )
      OR EXISTS (SELECT 1 FROM public.chat_rate_limit_counters WHERE window_end < v_short_cutoff)
    );
END;
$retention$;

REVOKE ALL ON FUNCTION public.purge_expired_user_content() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_user_content() TO service_role;
