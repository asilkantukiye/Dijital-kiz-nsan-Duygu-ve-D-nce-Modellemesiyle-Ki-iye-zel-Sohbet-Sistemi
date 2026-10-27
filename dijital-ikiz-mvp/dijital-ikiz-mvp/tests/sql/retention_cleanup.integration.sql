\set ON_ERROR_STOP on

-- Runs after the Stage 6 migrations in the disposable CI database.
BEGIN;
DO $retention_test$
DECLARE
  v_user_id uuid := '11111111-1111-4111-8111-111111111111';
  v_message_id uuid;
  v_hash text := repeat('b', 64);
  v_counter_subject text := 'retention-test-' || md5(random()::text);
  v_memory_content text := 'retention-test-' || md5(random()::text);
  v_result record;
BEGIN
  INSERT INTO public.messages (user_id, role, content, created_at)
  VALUES (v_user_id, 'user', 'retention-test-message-' || md5(random()::text), clock_timestamp() - interval '181 days')
  RETURNING id INTO v_message_id;

  INSERT INTO public.memory_items (
    user_id, memory_type, content, importance, embedding, created_at, updated_at, last_used_at
  ) VALUES (
    v_user_id, 'preference', v_memory_content, 0.5,
    ('[' || array_to_string(ARRAY[1.0::real] || array_fill(0.0::real, ARRAY[383]), ',') || ']')::extensions.vector(384),
    clock_timestamp() - interval '181 days',
    clock_timestamp() - interval '181 days',
    clock_timestamp() - interval '181 days'
  );

  INSERT INTO public.chat_request_deduplication (
    user_id, request_hash, status, owner_token, response,
    user_message_id, assistant_message_id, lease_expires_at,
    dedupe_expires_at, created_at, updated_at
  ) VALUES (
    v_user_id, v_hash, 'failed', NULL, NULL, NULL, NULL, NULL,
    clock_timestamp() - interval '1 day',
    clock_timestamp() - interval '2 days',
    clock_timestamp() - interval '1 day'
  );

  INSERT INTO public.chat_rate_limit_counters (
    scope, subject_hash, window_start, window_end, request_count, updated_at
  ) VALUES (
    'global-minute', v_counter_subject,
    date_trunc('minute', clock_timestamp() - interval '3 days'),
    date_trunc('minute', clock_timestamp() - interval '3 days') + interval '1 minute',
    1, clock_timestamp() - interval '3 days'
  );

  SELECT * INTO v_result FROM public.purge_expired_user_content();

  IF v_result.memory_items_deleted < 1 THEN
    RAISE EXCEPTION 'Expected inactive memory cleanup, got %', v_result.memory_items_deleted;
  END IF;
  IF v_result.dedupe_deleted < 1 THEN
    RAISE EXCEPTION 'Expected expired idempotency cleanup, got %', v_result.dedupe_deleted;
  END IF;
  IF v_result.rate_limit_deleted < 1 THEN
    RAISE EXCEPTION 'Expected stale rate-limit cleanup, got %', v_result.rate_limit_deleted;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.messages WHERE id = v_message_id) THEN
    RAISE EXCEPTION 'Retention policy must never delete chat history';
  END IF;
  IF EXISTS (SELECT 1 FROM public.chat_request_deduplication WHERE user_id = v_user_id AND request_hash = v_hash) THEN
    RAISE EXCEPTION 'Expired idempotency row was not removed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.chat_rate_limit_counters WHERE scope = 'global-minute' AND subject_hash = v_counter_subject) THEN
    RAISE EXCEPTION 'Stale rate-limit row was not removed';
  END IF;

  IF to_regclass('cron.job') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM cron.job
    WHERE jobname = 'digital-twin-retention-cleanup'
      AND active
      AND schedule = '17 * * * *'
  ) THEN
    RAISE EXCEPTION 'Expected active hourly cleanup cron schedule';
  END IF;
END
$retention_test$;
ROLLBACK;

SELECT 'PASS: inactive memory and expired metadata deleted; old chat message preserved; synthetic test data rolled back.' AS result;
