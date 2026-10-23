import assert from 'node:assert/strict'
import test from 'node:test'

import { buildContentSecurityPolicy, createCspNonce } from '../lib/csp.ts'

test('creates fresh nonce values suitable for script-src', () => {
  const first = createCspNonce()
  const second = createCspNonce()

  assert.match(first, /^[A-Za-z0-9+/=_-]+$/)
  assert.match(second, /^[A-Za-z0-9+/=_-]+$/)
  assert.notEqual(first, second)
})

test('production policy is nonce-based and has no unsafe-eval or wildcard script source', () => {
  const nonce = createCspNonce()
  const policy = buildContentSecurityPolicy(nonce, true)

  assert.match(policy, /default-src 'self'/)
  assert.ok(policy.includes(`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`))
  assert.match(policy, /object-src 'none'/)
  assert.match(policy, /frame-ancestors 'none'/)
  assert.match(policy, /base-uri 'self'/)
  assert.match(policy, /upgrade-insecure-requests/)
  assert.doesNotMatch(policy, /unsafe-eval|script-src[^;]*\*/i)
})

test('only Supabase HTTPS and Realtime WebSockets are allowed as browser connection targets', () => {
  const policy = buildContentSecurityPolicy('Y2hhbmdlLW1l', true)
  const connectSrc = policy.split('; ').find((part) => part.startsWith('connect-src '))

  assert.equal(connectSrc, "connect-src 'self' https://*.supabase.co wss://*.supabase.co")
  assert.doesNotMatch(connectSrc, /huggingface|upstash/i)
})

test('rejects nonce characters that are invalid in CSP sources', () => {
  assert.throws(() => buildContentSecurityPolicy('bad<nonce>', true), /Invalid CSP nonce/)
})

test('development policy avoids forcing HTTPS upgrades on local Supabase', () => {
  const policy = buildContentSecurityPolicy('ZGV2LW5vbmNl', false)
  assert.doesNotMatch(policy, /upgrade-insecure-requests/)
})
