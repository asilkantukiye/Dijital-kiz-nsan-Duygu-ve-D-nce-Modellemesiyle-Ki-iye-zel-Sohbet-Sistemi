import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { ChatProviderError, qwenChat, resolveChatCompletionsUrl } from '../lib/huggingface.ts'

const originalFetch = globalThis.fetch
const originalToken = process.env.HF_TOKEN
const originalModel = process.env.HF_MODEL
const originalChatUrl = process.env.HF_CHAT_COMPLETIONS_URL
const messages = [
  { role: 'system', content: 'Test system message' },
  { role: 'user', content: 'Merhaba' }
]

afterEach(() => {
  globalThis.fetch = originalFetch
  if (originalToken === undefined) delete process.env.HF_TOKEN
  else process.env.HF_TOKEN = originalToken
  if (originalModel === undefined) delete process.env.HF_MODEL
  else process.env.HF_MODEL = originalModel
  if (originalChatUrl === undefined) delete process.env.HF_CHAT_COMPLETIONS_URL
  else process.env.HF_CHAT_COMPLETIONS_URL = originalChatUrl
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

test('custom HF Inference Endpoint is selected without sending credentials to an untrusted host', async () => {
  process.env.HF_TOKEN = 'test-token-not-a-real-secret'
  process.env.HF_MODEL = 'tgi'
  process.env.HF_CHAT_COMPLETIONS_URL =
    'https://model-abc.us-east-1.aws.endpoints.huggingface.cloud/v1/chat/completions'

  let requestedUrl = ''
  let requestedBody = null
  globalThis.fetch = async (url, init) => {
    requestedUrl = String(url)
    requestedBody = JSON.parse(String(init?.body || '{}'))
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer test-token-not-a-real-secret')
    return new Response(JSON.stringify({ choices: [{ message: { content: 'endpoint-ok' } }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  assert.equal(await qwenChat(messages, 500), 'endpoint-ok')
  assert.equal(
    requestedUrl,
    'https://model-abc.us-east-1.aws.endpoints.huggingface.cloud/v1/chat/completions'
  )
  assert.equal(requestedBody.model, 'tgi')
})

test('invalid custom HF chat endpoint fails closed before sending a request', async () => {
  process.env.HF_TOKEN = 'test-token-not-a-real-secret'
  process.env.HF_CHAT_COMPLETIONS_URL =
    'https://attacker.example/v1/chat/completions'
  let requests = 0
  globalThis.fetch = async () => {
    requests += 1
    throw new Error('network must not be called for an untrusted endpoint')
  }

  await assert.rejects(qwenChat(messages, 200), (error) => {
    assert.ok(error instanceof ChatProviderError)
    assert.equal(error.code, 'AI_NOT_CONFIGURED')
    assert.equal(error.status, 503)
    assert.doesNotMatch(error.publicMessage, /attacker\.example|test-token|Bearer/i)
    return true
  })
  assert.equal(requests, 0)
})

test('chat endpoint resolver permits only trusted HTTPS endpoints without query credentials', () => {
  assert.equal(
    resolveChatCompletionsUrl('https://router.huggingface.co/v1/chat/completions'),
    'https://router.huggingface.co/v1/chat/completions'
  )
  assert.equal(
    resolveChatCompletionsUrl('https://router.huggingface.co/v1/chat/completions?token=secret'),
    null
  )
  assert.equal(resolveChatCompletionsUrl('http://router.huggingface.co/v1/chat/completions'), null)
  assert.equal(resolveChatCompletionsUrl('https://router.huggingface.co.attacker.example/v1/chat/completions'), null)
})
