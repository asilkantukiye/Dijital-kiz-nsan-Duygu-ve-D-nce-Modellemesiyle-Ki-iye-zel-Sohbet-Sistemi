import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'

const userId = '55555555-5555-4555-8555-555555555555'
const traitKeys = [
  'valence', 'arousal', 'dominance', 'openness', 'conscientiousness',
  'extraversion', 'agreeableness', 'neuroticism', 'informality',
  'emoji_frequency', 'humor', 'slang', 'avg_sentence_length'
]

function sqlString(value) {
  return "'" + String(value).replaceAll("'", "''") + "'"
}

function psql(sql, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const child = spawn('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-c', sql], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('psql exceeded ' + timeoutMs + 'ms; possible deadlock'))
    }, timeoutMs)

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        reject(new Error('psql failed (' + code + '): ' + stderr))
      } else {
        resolve(stdout.trim())
      }
    })
  })
}

async function main() {
  // Use a dedicated integration-test identity and make retries deterministic.
  await psql(`
    INSERT INTO auth.users (id) VALUES ('${userId}') ON CONFLICT (id) DO NOTHING;
    DELETE FROM public.chat_request_deduplication WHERE user_id = '${userId}';
    DELETE FROM public.messages WHERE user_id = '${userId}';
    DELETE FROM public.twin_profiles WHERE user_id = '${userId}';
  `)

  const observations = traitKeys.map((key) => ({
    valence: 0.5, arousal: 0.5, dominance: 0.5, openness: 0.5,
    conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5,
    neuroticism: 0.5, informality: 0.5, emoji_frequency: 0.5,
    humor: 0.5, slang: 0.5, avg_sentence_length: 0.5,
    [key]: 1
  }))

  // Different idempotency keys represent distinct simultaneous user messages.
  // Exactly one request changes each trait; a stale full-snapshot write would leave
  // most traits at 0.5, while the serialized SQL merge preserves every observation.
  const requests = observations.map(async (observation, index) => {
    const token = randomUUID()
    const hash = createHash('sha256').update('AUD-03 concurrent profile update ' + index).digest('hex')
    const userText = 'profile-concurrency-' + index
    const reply = 'reply-concurrency-' + index
    const userTime = new Date(Date.now() + index * 3).toISOString()
    const assistantTime = new Date(Date.parse(userTime) + 1).toISOString()
    const observationSql = sqlString(JSON.stringify(observation)) + '::jsonb'
    const sql = `
      SET ROLE service_role;
      DO $concurrent_profile_update$
      DECLARE claim_row record;
      BEGIN
        SELECT * INTO claim_row
        FROM public.claim_chat_request_server(
          '${userId}'::uuid,
          '${hash}',
          '${token}'::uuid
        );
        IF claim_row.disposition <> 'claimed' THEN
          RAISE EXCEPTION 'request ${index} did not acquire its unique claim';
        END IF;

        PERFORM * FROM public.persist_chat_turn_idempotent_server(
          '${userId}'::uuid,
          '${hash}',
          '${token}'::uuid,
          'personalized',
          ${sqlString(userText)},
          ${sqlString(reply)},
          ${sqlString(userTime)}::timestamptz,
          ${sqlString(assistantTime)}::timestamptz,
          ${observationSql},
          jsonb_build_object(
            'reply', ${sqlString(reply)},
            'profile', ${observationSql},
            'variant', 'personalized'
          )
        );
      END
      $concurrent_profile_update$;
      RESET ROLE;
    `
    return psql(sql)
  })

  await Promise.all(requests)

  const summary = await psql(`
    SELECT jsonb_build_object(
      'profile', profile,
      'user_messages', (SELECT count(*) FROM public.messages WHERE user_id = '${userId}' AND role = 'user'),
      'assistant_messages', (SELECT count(*) FROM public.messages WHERE user_id = '${userId}' AND role = 'assistant'),
      'completed_requests', (SELECT count(*) FROM public.chat_request_deduplication WHERE user_id = '${userId}' AND status = 'completed')
    )::text
    FROM public.twin_profiles
    WHERE user_id = '${userId}';
  `)
  const result = JSON.parse(summary)
  assert.equal(result.user_messages, traitKeys.length, 'every concurrent request must persist one user message')
  assert.equal(result.assistant_messages, traitKeys.length, 'every concurrent request must persist one assistant message')
  assert.equal(result.completed_requests, traitKeys.length, 'every concurrent request must complete its idempotency record')

  for (const key of traitKeys) {
    assert.equal(typeof result.profile[key], 'number', key + ' must remain numeric')
    assert.ok(result.profile[key] > 0.5, key + ' update was lost or overwritten by a stale snapshot')
    assert.ok(result.profile[key] <= 1, key + ' must stay inside the validated 0..1 range')
  }

  // Every persisted response/message snapshot must reflect a valid canonical profile.
  const inconsistent = await psql(`
    SELECT count(*)
    FROM public.messages
    WHERE user_id = '${userId}'
      AND role IN ('user', 'assistant')
      AND (
        profile_snapshot IS NULL
        OR (SELECT count(*) FROM jsonb_object_keys(profile_snapshot)) <> 13
        OR EXISTS (
          SELECT 1 FROM jsonb_each(profile_snapshot) AS kv(key, value)
          WHERE jsonb_typeof(value) <> 'number'
             OR NOT ((value #>> '{}')::numeric BETWEEN 0 AND 1)
        )
      );
  `)
  assert.equal(Number(inconsistent), 0, 'all message profile snapshots must remain valid and bounded')
  console.log('AUD-03 concurrent profile integration passed: ' + traitKeys.length + ' parallel updates, 0 lost traits, 0 deadlocks.')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
