import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { randomUUID } from 'node:crypto'

import { enforceChatRateLimit } from '../lib/distributed-rate-limit.ts'

const testDirectory = path.dirname(fileURLToPath(import.meta.url))

const productionEnvironment = {
  NODE_ENV: 'production',
  UPSTASH_REDIS_REST_URL: 'https://region-12345.upstash.io',
  UPSTASH_REDIS_REST_TOKEN: 'test-upstash-token',
  RATE_LIMIT_KEY_SALT: 's'.repeat(32)
}

function response(result, status = 200) {
  return new Response(JSON.stringify({ result }), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

test('production fails closed if distributed rate-limit configuration is missing', async () => {
  let calls = 0
  const result = await enforceChatRateLimit('user-production-missing', {
    environment: { NODE_ENV: 'production' },
    fetcher: async () => {
      calls += 1
      return response([1, 0, 'allowed'])
    }
  })

  assert.equal(result.allowed, false)
  assert.equal(result.unavailable, true)
  assert.equal(result.reason, 'backend')
  assert.equal(calls, 0)
})

test('partial configuration also fails closed rather than silently using a local counter', async () => {
  const result = await enforceChatRateLimit('user-partial-config', {
    environment: {
      NODE_ENV: 'development',
      UPSTASH_REDIS_REST_URL: productionEnvironment.UPSTASH_REDIS_REST_URL
    },
    fetcher: async () => response([1, 0, 'allowed'])
  })

  assert.equal(result.allowed, false)
  assert.equal(result.unavailable, true)
})

test('development without Upstash uses bounded local fallback for tests only', async () => {
  const userId = 'dev-fallback-' + randomUUID()
  const environment = { NODE_ENV: 'development' }

  for (let attempt = 1; attempt <= 20; attempt += 1) {
    const result = await enforceChatRateLimit(userId, { environment })
    assert.equal(result.allowed, true, 'request ' + attempt + ' should be allowed')
    assert.equal(result.reason, 'development-local')
  }

  const blocked = await enforceChatRateLimit(userId, { environment })
  assert.equal(blocked.allowed, false)
  assert.equal(blocked.unavailable, false)
  assert.equal(blocked.reason, 'user')
  assert.ok(blocked.retryAfterSeconds >= 1)
})

test('Upstash request uses one atomic EVAL and never sends the raw user ID', async () => {
  let requestedUrl = ''
  let requestInit
  const userId = 'private-user-id-must-not-be-sent'

  const result = await enforceChatRateLimit(userId, {
    environment: productionEnvironment,
    now: new Date('2026-10-22T12:34:56.000Z'),
    fetcher: async (url, init) => {
      requestedUrl = String(url)
      requestInit = init
      return response([1, 0, 'allowed'])
    }
  })

  assert.equal(result.allowed, true)
  assert.equal(result.unavailable, false)
  assert.equal(result.reason, 'allowed')
  assert.equal(requestedUrl, productionEnvironment.UPSTASH_REDIS_REST_URL)
  assert.ok(requestInit)
  assert.equal(requestInit.method, 'POST')
  assert.equal(requestInit.headers.Authorization, 'Bearer test-upstash-token')
  assert.ok(requestInit.signal instanceof AbortSignal)

  const command = JSON.parse(requestInit.body)
  assert.equal(command[0], 'EVAL')
  assert.equal(command[2], '3')
  assert.match(command[1], /redis\.call\("INCR"/)
  assert.match(command[1], /redis\.call\("PEXPIRE"/)
  assert.equal(command[3].includes(userId), false)
  assert.match(command[3], /dijital-ikiz:\{chat\}:user:/)
  assert.equal(command[4], 'dijital-ikiz:{chat}:global:minute')
  assert.equal(command[5], 'dijital-ikiz:{chat}:global:day:2026-10-22')
})

test('per-user and global windows return controlled retry decisions', async () => {
  for (const [redisResult, expectedReason, expectedRetry] of [
    [[0, 18_000, 'user'], 'user', 18],
    [[0, 43_000, 'global-minute'], 'global-minute', 43],
    [[0, 86_400_000, 'global-day'], 'global-day', 86_400]
  ]) {
    const result = await enforceChatRateLimit('test-user-' + expectedReason, {
      environment: productionEnvironment,
      fetcher: async () => response(redisResult)
    })

    assert.equal(result.allowed, false)
    assert.equal(result.unavailable, false)
    assert.equal(result.reason, expectedReason)
    assert.equal(result.retryAfterSeconds, expectedRetry)
  }
})

test('malformed responses, non-success statuses and network errors fail closed', async () => {
  const failures = [
    async () => response({ unexpected: true }),
    async () => response([2, 0, 'allowed']),
    async () => response([0, -10, 'user']),
    async () => response([0, 1000, 'unknown-reason']),
    async () => response([1, 0, 'allowed'], 503),
    async () => { throw new Error('simulated Redis timeout') }
  ]

  for (const [index, fetcher] of failures.entries()) {
    const result = await enforceChatRateLimit('failure-user-' + index, {
      environment: productionEnvironment,
      fetcher: fetcher
    })
    assert.equal(result.allowed, false, 'failure ' + index)
    assert.equal(result.unavailable, true, 'failure ' + index)
    assert.equal(result.reason, 'backend', 'failure ' + index)
  }
})

test('chat route denies inference before calling the model when the limiter blocks', async () => {
  const route = await readFile(path.join(testDirectory, '..', 'app', 'api', 'chat', 'route.ts'), 'utf8')
  const limiterPosition = route.indexOf('await enforceChatRateLimit(user.id)')
  const modelPosition = route.indexOf('await qwenChat(modelMessages)')

  assert.ok(limiterPosition >= 0, 'route must call distributed limiter')
  assert.ok(modelPosition > limiterPosition, 'model inference must happen after the limiter')
  assert.match(route, /rateLimitDecision\.unavailable \? 503 : 429/)
  assert.match(route, /'Retry-After': String\(rateLimitDecision\.retryAfterSeconds\)/)
})

test('invalid endpoint and short secret salt are rejected before network access', async () => {
  let calls = 0
  for (const environment of [
    { ...productionEnvironment, UPSTASH_REDIS_REST_URL: 'http://region-12345.upstash.io' },
    { ...productionEnvironment, UPSTASH_REDIS_REST_URL: 'https://attacker.example' },
    { ...productionEnvironment, UPSTASH_REDIS_REST_URL: 'https://region-12345.upstash.io/?token=not-allowed' },
    { ...productionEnvironment, RATE_LIMIT_KEY_SALT: 'short' }
  ]) {
    const result = await enforceChatRateLimit('invalid-config-user', {
      environment,
      fetcher: async () => {
        calls += 1
        return response([1, 0, 'allowed'])
      }
    })
    assert.equal(result.unavailable, true)
  }
  assert.equal(calls, 0)
})
