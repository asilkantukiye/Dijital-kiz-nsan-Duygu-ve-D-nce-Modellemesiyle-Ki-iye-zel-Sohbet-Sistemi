import assert from 'node:assert/strict'
import test from 'node:test'

import { probeUpstreams } from '../lib/health-probes.ts'

const environment = {
  supabaseUrl: 'https://project.supabase.co',
  supabasePublishableKey: 'public-test-key',
  huggingfaceToken: 'hf-test-token',
  upstashRedisRestUrl: 'https://region-12345.upstash.io',
  upstashRedisRestToken: 'redis-test-token'
}

test('deep probe checks Supabase Auth, Hugging Face identity, and Redis PING', async () => {
  const calls = []
  const result = await probeUpstreams(environment, async (url, init) => {
    calls.push({ url: String(url), init })
    if (String(url).includes('/auth/v1/health')) return new Response('ok', { status: 200 })
    if (String(url).includes('/api/whoami-v2')) return new Response('{}', { status: 200 })
    return new Response(JSON.stringify({ result: 'PONG' }), { status: 200 })
  })

  assert.equal(result.ok, true)
  assert.deepEqual(result.providers, { supabase: true, huggingface: true, rateLimit: true })
  assert.equal(calls.length, 3)
  assert.ok(calls.every((call) => call.init.cache === 'no-store'))
  assert.ok(calls.every((call) => call.init.signal instanceof AbortSignal))
  assert.ok(calls.every((call) => call.init.signal.aborted === false))
})

test('provider failures become booleans and fail the aggregate health check', async () => {
  const result = await probeUpstreams(environment, async (url) => {
    if (String(url).includes('/auth/v1/health')) throw new Error('private internal detail')
    if (String(url).includes('/api/whoami-v2')) return new Response('denied', { status: 401 })
    return new Response(JSON.stringify({ result: 'not-pong' }), { status: 200 })
  })

  assert.equal(result.ok, false)
  assert.deepEqual(result.providers, { supabase: false, huggingface: false, rateLimit: false })
  assert.doesNotMatch(JSON.stringify(result), /private internal detail|hf-test-token|redis-test-token/)
})

test('missing or unsafe endpoint configuration fails closed without outbound calls', async () => {
  let calls = 0
  const result = await probeUpstreams({
    supabaseUrl: 'http://attacker.example',
    supabasePublishableKey: 'key',
    huggingfaceToken: '',
    upstashRedisRestUrl: 'https://attacker.example',
    upstashRedisRestToken: 'token'
  }, async () => {
    calls += 1
    return new Response('{}', { status: 200 })
  })

  assert.equal(result.ok, false)
  assert.deepEqual(result.providers, { supabase: false, huggingface: false, rateLimit: false })
  assert.equal(calls, 0)
})

test('Redis HTTP success without PONG does not count as healthy', async () => {
  const result = await probeUpstreams(environment, async (url) => {
    if (String(url).includes('/auth/v1/health')) return new Response('ok', { status: 200 })
    if (String(url).includes('/api/whoami-v2')) return new Response('{}', { status: 200 })
    return new Response(JSON.stringify({ result: 'error' }), { status: 200 })
  })

  assert.equal(result.ok, false)
  assert.equal(result.providers.rateLimit, false)
})

test('Upstash URLs containing credentials, query strings, custom paths, or non-HTTPS schemes are rejected', async () => {
  for (const upstashUrl of [
    'http://region-12345.upstash.io',
    'https://user:password@region-12345.upstash.io',
    'https://region-12345.upstash.io/?token=oops',
    'https://region-12345.upstash.io/custom',
    'https://region-12345.upstash.io.attacker.example'
  ]) {
    let calls = 0
    const result = await probeUpstreams({
      ...environment,
      upstashRedisRestUrl: upstashUrl
    }, async (url) => {
      calls += 1
      if (String(url).includes('/auth/v1/health')) return new Response('ok', { status: 200 })
      if (String(url).includes('/api/whoami-v2')) return new Response('{}', { status: 200 })
      return new Response(JSON.stringify({ result: 'PONG' }), { status: 200 })
    })
    assert.equal(result.providers.rateLimit, false, upstashUrl)
    assert.equal(result.ok, false, upstashUrl)
    assert.equal(calls, 2, upstashUrl)
  }
})
