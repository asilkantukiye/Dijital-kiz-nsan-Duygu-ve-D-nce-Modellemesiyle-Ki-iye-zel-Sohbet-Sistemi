import assert from 'node:assert/strict'
import test from 'node:test'

import { buildHealthStatus } from '../lib/health-status.ts'

test('health is live but not ready when backend configuration is missing', () => {
  const status = buildHealthStatus({})

  assert.equal(status.ok, true)
  assert.equal(status.ready, false)
  assert.deepEqual(status.configured, {
    supabase: false,
    huggingface: false,
    rateLimit: false,
    serverWriteBoundary: false
  })
})

test('health is ready only when Supabase, server-only writes and Hugging Face are configured', () => {
  const status = buildHealthStatus({
    supabaseUrl: 'https://project.example.supabase.co',
    supabasePublishableKey: 'publishable-placeholder',
    supabaseServiceRoleKey: 'service-role-placeholder',
    huggingfaceToken: 'secret-placeholder',
    nodeEnv: 'development'
  })

  assert.equal(status.ok, true)
  assert.equal(status.ready, true)
  assert.deepEqual(status.configured, {
    supabase: true,
    huggingface: true,
    rateLimit: false,
    serverWriteBoundary: true
  })
})

test('malformed or unsafe Supabase URLs never report readiness', () => {
  const invalidUrls = [
    'not-a-url',
    'ftp://project.example.supabase.co',
    'http://project.example.supabase.co',
    'https://user:password@project.example.supabase.co',
    'https://project.example.supabase.co?redirect=elsewhere',
    'https://project.example.supabase.co#fragment'
  ]

  for (const supabaseUrl of invalidUrls) {
    const status = buildHealthStatus({
      supabaseUrl,
      supabasePublishableKey: 'publishable-placeholder',
      huggingfaceToken: 'secret-placeholder'
    })

    assert.equal(status.ready, false, `Expected not ready for URL: ${supabaseUrl}`)
    assert.equal(status.configured.supabase, false)
  }
})

test('local loopback HTTP is accepted for development readiness', () => {
  const status = buildHealthStatus({
    supabaseUrl: 'http://localhost:54321',
    supabasePublishableKey: 'publishable-placeholder',
    supabaseServiceRoleKey: 'service-role-placeholder',
    huggingfaceToken: 'secret-placeholder'
  })

  assert.equal(status.ready, true)
  assert.equal(status.configured.supabase, true)
})

test('health is not ready when the server-only write key is missing', () => {
  const status = buildHealthStatus({
    supabaseUrl: 'https://project.example.supabase.co',
    supabasePublishableKey: 'publishable-placeholder',
    huggingfaceToken: 'secret-placeholder'
  })

  assert.equal(status.ready, false)
  assert.equal(status.configured.serverWriteBoundary, false)
})

test('health is not ready if any required provider configuration is absent', () => {
  const missingSupabaseKey = buildHealthStatus({
    supabaseUrl: 'https://project.example.supabase.co',
    huggingfaceToken: 'secret-placeholder'
  })
  const missingHuggingFace = buildHealthStatus({
    supabaseUrl: 'https://project.example.supabase.co',
    supabasePublishableKey: 'publishable-placeholder'
  })

  assert.equal(missingSupabaseKey.ready, false)
  assert.equal(missingHuggingFace.ready, false)
})

test('whitespace-only environment values count as missing', () => {
  const status = buildHealthStatus({
    supabaseUrl: '  ',
    supabasePublishableKey: '\t',
    huggingfaceToken: '\n'
  })

  assert.equal(status.ready, false)
  assert.deepEqual(status.configured, {
    supabase: false,
    huggingface: false,
    rateLimit: false,
    serverWriteBoundary: false
  })
})

test('health response reports configuration presence, never credential values', () => {
  const status = buildHealthStatus({
    supabaseUrl: 'https://project.example.supabase.co',
    supabasePublishableKey: 'publishable-secret-must-not-appear',
    supabaseServiceRoleKey: 'service-role-secret-must-not-appear',
    huggingfaceToken: 'hf-secret-must-not-appear'
  })
  const serialized = JSON.stringify(status)

  assert.doesNotMatch(serialized, /publishable-secret-must-not-appear/)
  assert.doesNotMatch(serialized, /hf-secret-must-not-appear/)
  assert.doesNotMatch(serialized, /service-role-secret-must-not-appear/)
})


test('production readiness requires a valid distributed rate-limit configuration', () => {
  const base = {
    supabaseUrl: 'https://project.example.supabase.co',
    supabasePublishableKey: 'publishable-placeholder',
    supabaseServiceRoleKey: 'service-role-placeholder',
    huggingfaceToken: 'secret-placeholder',
    nodeEnv: 'production'
  }

  const withoutLimiter = buildHealthStatus(base)
  assert.equal(withoutLimiter.ok, true)
  assert.equal(withoutLimiter.ready, false)
  assert.equal(withoutLimiter.configured.rateLimit, false)

  const configured = buildHealthStatus({
    ...base,
    upstashRedisRestUrl: 'https://region-12345.upstash.io',
    upstashRedisRestToken: 'private-test-token',
    rateLimitKeySalt: 'x'.repeat(32)
  })
  assert.equal(configured.ready, true)
  assert.equal(configured.configured.rateLimit, true)
  assert.doesNotMatch(JSON.stringify(configured), /private-test-token|x{32}/)
})

test('production readiness requires Upstash even when the Supabase server key exists', () => {
  const status = buildHealthStatus({
    supabaseUrl: 'https://project.example.supabase.co',
    supabasePublishableKey: 'publishable-placeholder',
    supabaseServiceRoleKey: 'service-role-placeholder',
    huggingfaceToken: 'secret-placeholder',
    rateLimitKeySalt: 's'.repeat(32),
    nodeEnv: 'production'
  })

  assert.equal(status.ready, false)
  assert.equal(status.configured.rateLimit, false)
  assert.equal(status.configured.serverWriteBoundary, true)
})

test('production readiness rejects malformed Upstash URLs and short key salts', () => {
  const status = buildHealthStatus({
    supabaseUrl: 'https://project.example.supabase.co',
    supabasePublishableKey: 'publishable-placeholder',
    huggingfaceToken: 'secret-placeholder',
    upstashRedisRestUrl: 'http://region-12345.upstash.io',
    upstashRedisRestToken: 'private-test-token',
    rateLimitKeySalt: 'too-short',
    nodeEnv: 'production'
  })

  assert.equal(status.ready, false)
  assert.equal(status.configured.rateLimit, false)
})

test('production readiness rejects Upstash endpoint query strings', () => {
  const status = buildHealthStatus({
    supabaseUrl: 'https://project.example.supabase.co',
    supabasePublishableKey: 'publishable-placeholder',
    huggingfaceToken: 'secret-placeholder',
    upstashRedisRestUrl: 'https://region-12345.upstash.io/?token=accidental',
    upstashRedisRestToken: 'private-test-token',
    rateLimitKeySalt: 's'.repeat(32),
    nodeEnv: 'production'
  })

  assert.equal(status.ready, false)
  assert.equal(status.configured.rateLimit, false)
})

test('production readiness rejects Upstash endpoints with a non-root path', () => {
  const status = buildHealthStatus({
    supabaseUrl: 'https://project.example.supabase.co',
    supabasePublishableKey: 'publishable-placeholder',
    huggingfaceToken: 'secret-placeholder',
    upstashRedisRestUrl: 'https://region-12345.upstash.io/rest/v1',
    upstashRedisRestToken: 'private-test-token',
    rateLimitKeySalt: 's'.repeat(32),
    nodeEnv: 'production'
  })

  assert.equal(status.ready, false)
  assert.equal(status.configured.rateLimit, false)
  assert.doesNotMatch(JSON.stringify(status), /private-test-token|s{32}/)
})
