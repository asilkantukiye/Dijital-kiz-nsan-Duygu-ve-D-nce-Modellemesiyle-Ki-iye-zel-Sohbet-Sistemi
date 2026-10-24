import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import {
  claimChatRequestWithWait,
  createChatRequestOwnerToken,
  hashChatRequest
} from '../lib/chat-idempotency.ts'

const testDirectory = path.dirname(fileURLToPath(import.meta.url))
const projectDirectory = path.resolve(testDirectory, '..')

test('SHA-256 fingerprint is stable and scoped by variant/content', () => {
  const first = hashChatRequest('personalized', 'Aynı mesaj')
  assert.match(first, /^[0-9a-f]{64}$/)
  assert.equal(first, hashChatRequest('personalized', 'Aynı mesaj'))
  assert.notEqual(first, hashChatRequest('baseline', 'Aynı mesaj'))
  assert.notEqual(first, hashChatRequest('personalized', 'Başka mesaj'))
})

test('concurrent identical requests make one model call and persist one chat turn', async () => {
  const store = new Map()
  let modelCalls = 0
  let persistCalls = 0
  let persistedMessageRows = 0

  async function claim(userId, requestHash, ownerToken) {
    const key = [userId, requestHash].join(':')
    const current = store.get(key)
    const now = Date.now()

    if (
      !current ||
      current.status === 'failed' ||
      (current.status === 'processing' && current.leaseExpiresAt <= now) ||
      (current.status === 'completed' && current.dedupeExpiresAt <= now)
    ) {
      store.set(key, {
        status: 'processing',
        ownerToken,
        leaseExpiresAt: now + 5000,
        dedupeExpiresAt: now + 5000,
        response: null
      })
      return { disposition: 'claimed' }
    }

    if (current.status === 'completed') {
      return { disposition: 'replay', response: current.response }
    }

    return { disposition: 'in_progress' }
  }

  async function submit() {
    const userId = 'user-1'
    const requestHash = hashChatRequest('personalized', 'Aynı anda gönderilen mesaj')
    const ownerToken = createChatRequestOwnerToken()
    const key = [userId, requestHash].join(':')

    const result = await claimChatRequestWithWait(
      () => claim(userId, requestHash, ownerToken),
      { waitMs: 1000, pollIntervalMs: 2 }
    )

    if (result.disposition === 'replay') return result.response
    if (result.disposition === 'in_progress') return null

    assert.equal(result.disposition, 'claimed')
    modelCalls += 1
    await new Promise((resolve) => setTimeout(resolve, 25))

    const row = store.get(key)
    assert.equal(row.ownerToken, ownerToken)
    const response = {
      reply: 'Tek üretilen yanıt',
      profile: { tone: 'calm' },
      variant: 'personalized',
      messageId: 'assistant-message-1'
    }

    // Mimics the server RPC transaction: cache + user/assistant rows become
    // visible together, and every later claimant receives this same response.
    row.status = 'completed'
    row.response = response
    row.ownerToken = null
    row.leaseExpiresAt = null
    row.dedupeExpiresAt = Date.now() + 10_000
    persistCalls += 1
    persistedMessageRows += 2
    return response
  }

  const responses = await Promise.all(Array.from({ length: 24 }, () => submit()))

  assert.equal(modelCalls, 1, 'only the PostgreSQL claim owner may reach model inference')
  assert.equal(persistCalls, 1, 'response and message pair must be persisted once')
  assert.equal(persistedMessageRows, 2, 'one chat turn contains one user and one assistant row')
  assert.equal(store.size, 1, 'identical requests share one fingerprint record')
  assert.ok(responses.every((response) => response?.messageId === 'assistant-message-1'))
})

test('database-backed route uses idempotency claim before model and atomic cached persistence', async () => {
  const route = await readFile(path.join(projectDirectory, 'app/api/chat/route.ts'), 'utf8')
  const client = await readFile(path.join(projectDirectory, 'app/page.tsx'), 'utf8')
  const migration = await readFile(
    path.join(projectDirectory, 'supabase/migrations/20261023200000_aud_02_chat_deduplication.sql'),
    'utf8'
  )
  const sqlTest = await readFile(
    path.join(projectDirectory, 'tests/sql/chat_idempotency.integration.sql'),
    'utf8'
  )

  assert.ok(route.indexOf('claimChatRequestWithWait') < route.indexOf('qwenChat(modelMessages)'))
  assert.ok(route.indexOf('qwenChat(modelMessages)') < route.indexOf("rpc('persist_chat_turn_idempotent_server'"))
  assert.match(route, /disposition === 'replay'/)
  assert.match(route, /status: 202/)
  assert.match(client, /response\.status !== 202/)
  assert.match(migration, /primary key \(user_id, request_hash\)/i)
  assert.match(migration, /dedupe_expires_at = clock_timestamp\(\) \+ interval '10 seconds'/i)
  assert.match(migration, /for update/i)
  assert.match(migration, /set status = 'completed'[\s\S]*?response = v_response/i)
  assert.match(sqlTest, /second identical claim did not return in_progress/)
  assert.match(sqlTest, /completed request did not return the cached response/)
})

test('production SQL keeps idempotency table and writer RPCs server-only', async () => {
  const migration = await readFile(
    path.join(projectDirectory, 'supabase/migrations/20261023200000_aud_02_chat_deduplication.sql'),
    'utf8'
  )
  const repositoryDirectory = path.resolve(testDirectory, '../../..')
  const workflow = await readFile(
    path.join(repositoryDirectory, '.github', 'workflows', 'ci.yml'),
    'utf8'
  )

  assert.match(migration, /alter table public\.chat_request_deduplication enable row level security/i)
  assert.match(migration, /from public, anon, authenticated/i)
  assert.match(migration, /grant execute on function public\.claim_chat_request_server[\s\S]*?to service_role/i)
  assert.match(migration, /grant execute on function public\.release_chat_request_server[\s\S]*?to service_role/i)
  assert.match(workflow, /20261023200000_aud_02_chat_deduplication\.sql/)
  assert.match(workflow, /tests\/sql\/chat_idempotency\.integration\.sql/)
})
