\set ON_ERROR_STOP on

-- Verify deleting user-owned data invalidates active and completed request claims,
-- and that a stale worker cannot claim or persist after deletion. Entire fixture rolls back.
BEGIN;

INSERT INTO public.chat_user_data_generations (user_id, generation)
VALUES
  ('11111111-1111-4111-8111-111111111111', 0),
  ('22222222-2222-4222-8222-222222222222', 0)
ON CONFLICT (user_id) DO UPDATE
SET generation = EXCLUDED.generation,
    updated_at = clock_timestamp();

SET LOCAL ROLE service_role;
INSERT INTO public.chat_request_deduplication (
  user_id, request_hash, generation, status, owner_token,
  lease_expires_at, dedupe_expires_at
)
VALUES
  (
    '11111111-1111-4111-8111-111111111111',
    repeat('c', 64), 0, 'processing',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    clock_timestamp() + interval '5 minutes',
    clock_timestamp() + interval '5 minutes'
  ),
  (
    '11111111-1111-4111-8111-111111111111',
    repeat('d', 64), 0, 'processing',
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    clock_timestamp() + interval '5 minutes',
    clock_timestamp() + interval '5 minutes'
  ),
  (
    '22222222-2222-4222-8222-222222222222',
    repeat('e', 64), 0, 'processing',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    clock_timestamp() + interval '5 minutes',
    clock_timestamp() + interval '5 minutes'
  );
RESET ROLE;

SET LOCAL request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
SET LOCAL ROLE authenticated;

DO $delete_inflight$
DECLARE
  result jsonb;
BEGIN
  result := public.delete_my_chat_data();

  IF (result ->> 'dedupe_rows_deleted')::integer <> 2 THEN
    RAISE EXCEPTION 'data deletion must remove both active claims for the current user; result=%', result;
  END IF;
END
$delete_inflight$;

RESET ROLE;
SET LOCAL ROLE service_role;

DO $stale_worker_rejected$
DECLARE
  rejected boolean := false;
  claim_row record;
  generation_value integer;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.chat_request_deduplication
    WHERE user_id = '11111111-1111-4111-8111-111111111111'
  ) THEN
    RAISE EXCEPTION 'deletion left a current-user idempotency claim';
  END IF;

  IF (SELECT count(*) FROM public.chat_request_deduplication
      WHERE user_id = '22222222-2222-4222-8222-222222222222'
        AND request_hash = repeat('e', 64)) <> 1 THEN
    RAISE EXCEPTION 'deletion changed another user idempotency claim';
  END IF;

  generation_value := public.get_chat_data_generation_server(
    '11111111-1111-4111-8111-111111111111'
  );
  IF generation_value <> 1 THEN
    RAISE EXCEPTION 'deletion generation expected 1, got %', generation_value;
  END IF;

  BEGIN
    PERFORM * FROM public.persist_chat_turn_idempotent_server(
      '11111111-1111-4111-8111-111111111111',
      repeat('c', 64),
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      'baseline',
      'a message from a stale worker',
      'a late response',
      clock_timestamp(),
      clock_timestamp() + interval '1 millisecond',
      NULL,
      jsonb_build_object('reply', 'a late response', 'variant', 'baseline', 'profile', NULL)
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'Chat request was not claimed' THEN
      rejected := true;
    ELSE
      RAISE;
    END IF;
  END;

  IF NOT rejected THEN
    RAISE EXCEPTION 'a deleted in-flight claim allowed a late worker to persist';
  END IF;

  rejected := false;
  BEGIN
    SELECT * INTO claim_row
    FROM public.claim_chat_request_server(
      '11111111-1111-4111-8111-111111111111',
      repeat('f', 64),
      'ffffffff-ffff-4fff-8fff-ffffffffffff',
      0
    );
  EXCEPTION WHEN SQLSTATE 'P0409' THEN
    rejected := true;
  END;

  IF NOT rejected THEN
    RAISE EXCEPTION 'a stale pre-deletion generation was allowed to claim new work';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.chat_request_deduplication
    WHERE user_id = '11111111-1111-4111-8111-111111111111'
      AND request_hash = repeat('f', 64)
  ) THEN
    RAISE EXCEPTION 'stale-generation claim wrote an idempotency row';
  END IF;

  SELECT * INTO claim_row
  FROM public.claim_chat_request_server(
    '11111111-1111-4111-8111-111111111111',
    repeat('a', 64),
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    generation_value
  );

  IF claim_row.disposition <> 'claimed' THEN
    RAISE EXCEPTION 'a claim with the current generation should be admitted';
  END IF;

  PERFORM public.release_chat_request_server(
    '11111111-1111-4111-8111-111111111111',
    repeat('a', 64),
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  );
END
$stale_worker_rejected$;

ROLLBACK;
