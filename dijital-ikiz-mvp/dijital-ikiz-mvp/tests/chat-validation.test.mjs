import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import {
  MAX_CHAT_MESSAGE_LENGTH,
  validateChatPayload
} from '../lib/chat-validation.ts'

const testDirectory = path.dirname(fileURLToPath(import.meta.url))
const routePath = path.resolve(testDirectory, '../app/api/chat/route.ts')

test('rejects null, arrays, primitives and malformed JSON fallback values as request objects', () => {
  for (const payload of [null, undefined, [], 'text', 10, false]) {
    const result = validateChatPayload(payload)
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.equal(result.status, 400)
      assert.match(result.error, /sohbet isteği/i)
    }
  }
})

test('requires a string message instead of coercing objects or numbers', () => {
  for (const message of [123, true, {}, [], null]) {
    const result = validateChatPayload({ message, variant: 'personalized' })
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.equal(result.status, 400)
      assert.match(result.error, /metin olmalıdır/i)
    }
  }
})

test('accepts valid personalized and baseline payloads', () => {
  for (const variant of ['personalized', 'baseline']) {
    const result = validateChatPayload({ message: 'Merhaba', variant })
    assert.equal(result.ok, true)
    if (result.ok) assert.deepEqual(result.value, { message: 'Merhaba', variant })
  }
})

test('rejects unsupported experiment variants', () => {
  const result = validateChatPayload({ message: 'Merhaba', variant: 'admin' })
  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.error, /varyant/i)
})

test('rejects client-supplied user and session identity fields', () => {
  for (const extra of [
    { user_id: 'victim-user-id' },
    { userId: 'victim-user-id' },
    { session_id: 'forged-session-id' },
    { sessionId: 'forged-session-id' }
  ]) {
    const result = validateChatPayload({
      message: 'Merhaba',
      variant: 'personalized',
      ...extra
    })
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.equal(result.status, 400)
      assert.match(result.error, /mesaj ve varyant/i)
    }
  }
})

test('trims messages and removes control characters before checking emptiness', () => {
  const valid = validateChatPayload({
    message: '  Mer\u0000haba\u0007  ',
    variant: 'baseline'
  })
  assert.equal(valid.ok, true)
  if (valid.ok) assert.equal(valid.value.message, 'Merhaba')

  for (const message of ['', '   ', '\u0000\u0007']) {
    const empty = validateChatPayload({ message, variant: 'baseline' })
    assert.equal(empty.ok, false)
    if (!empty.ok) assert.match(empty.error, /boş/i)
  }
})

test('enforces the 4000-character limit after sanitation', () => {
  const accepted = validateChatPayload({
    message: 'x'.repeat(MAX_CHAT_MESSAGE_LENGTH),
    variant: 'personalized'
  })
  assert.equal(accepted.ok, true)

  const rejected = validateChatPayload({
    message: 'x'.repeat(MAX_CHAT_MESSAGE_LENGTH + 1),
    variant: 'personalized'
  })
  assert.equal(rejected.ok, false)
  if (!rejected.ok) {
    assert.equal(rejected.status, 413)
    assert.match(rejected.error, /4000/)
  }
})

test('chat route bounds body bytes before validating message properties', async () => {
  const route = await readFile(routePath, 'utf8')

  assert.match(route, /readJsonBodyLimited\(req,\s*16\s*\*\s*1024\)/)
  assert.match(route, /validateChatPayload\(bodyResult\.value\)/)
  assert.doesNotMatch(route, /req\.json\(\)/)
  assert.match(route, /sanitizeChatText\(item\.content\)/)
  assert.doesNotMatch(route, /sanitizeText\(body\.message\)/)
})
