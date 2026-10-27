import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { ChatProviderError, qwenChat } from '../lib/huggingface.ts'

const originalFetch = globalThis.fetch
const originalToken = process.env.HF_TOKEN
const messages = [
  { role: 'system', content: 'Test system message' },
  { role: 'user', content: 'Merhaba' }
]

afterEach(() => {
  globalThis.fetch = originalFetch
  if (originalToken === undefined) delete process.env.HF_TOKEN
  else process.env.HF_TOKEN = originalToken
})

test('missing HF_TOKEN yields a safe 503 without calling the provider', async () => {
  delete process.env.HF_TOKEN
  globalThis.fetch = async () => {
    throw new Error('Provider must not be called when token is absent')
  }

  await assert.rejects(qwenChat(messages), (error) => {
    assert.ok(error instanceof ChatProviderError)
    assert.equal(error.code, 'AI_NOT_CONFIGURED')
    assert.equal(error.status, 503)
    assert.match(error.publicMessage, /kullanıma hazır değil/)
    assert.doesNotMatch(error.publicMessage, /HF_TOKEN|Bearer|secret/i)
    return true
  })
})

test('provider network failure returns a safe 503 after bounded retry', async () => {
  process.env.HF_TOKEN = 'test-token-not-a-real-secret'
  let attempts = 0
  globalThis.fetch = async () => {
    attempts += 1
    throw new TypeError('private transport diagnostic')
  }

  await assert.rejects(qwenChat(messages, 200), (error) => {
    assert.ok(error instanceof ChatProviderError)
    assert.equal(error.code, 'AI_PROVIDER_UNAVAILABLE')
    assert.equal(error.status, 503)
    assert.doesNotMatch(error.publicMessage, /private transport|test-token|Bearer/i)
    return true
  })
  assert.equal(attempts, 2)
})

test('provider rate limiting is converted to a safe retryable 503', async () => {
  process.env.HF_TOKEN = 'test-token-not-a-real-secret'
  let attempts = 0
  globalThis.fetch = async () => {
    attempts += 1
    return new Response(JSON.stringify({ error: 'private provider payload' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  await assert.rejects(qwenChat(messages, 200), (error) => {
    assert.ok(error instanceof ChatProviderError)
    assert.equal(error.code, 'AI_PROVIDER_BUSY')
    assert.equal(error.status, 503)
    assert.match(error.publicMessage, /yoğun/)
    assert.doesNotMatch(error.publicMessage, /private provider payload|test-token/i)
    return true
  })
  assert.equal(attempts, 2)
})

test('invalid provider response is mapped to a safe 502', async () => {
  process.env.HF_TOKEN = 'test-token-not-a-real-secret'
  globalThis.fetch = async () => new Response(
    JSON.stringify({ choices: [{ message: { content: '   ' } }] }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )

  await assert.rejects(qwenChat(messages, 200), (error) => {
    assert.ok(error instanceof ChatProviderError)
    assert.equal(error.code, 'AI_INVALID_RESPONSE')
    assert.equal(error.status, 502)
    assert.doesNotMatch(error.publicMessage, /test-token|Bearer|provider payload/i)
    return true
  })
})
