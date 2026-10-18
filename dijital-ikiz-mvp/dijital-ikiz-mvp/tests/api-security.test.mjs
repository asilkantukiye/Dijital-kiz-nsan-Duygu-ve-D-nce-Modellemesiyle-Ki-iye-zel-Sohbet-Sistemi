import assert from 'node:assert/strict'
import test from 'node:test'

import { isAllowedOrigin } from '../lib/api-security.ts'

const requestUrl = 'https://app.example.test/api/feedback'

test('allows same-origin browser mutations', () => {
  const result = isAllowedOrigin(new Request(requestUrl, {
    method: 'POST',
    headers: { Origin: 'https://app.example.test' }
  }))

  assert.equal(result, true)
})

test('allows requests with no Origin header for non-browser clients by policy', () => {
  assert.equal(isAllowedOrigin(new Request(requestUrl, { method: 'POST' })), true)
})

test('rejects requests from another origin', () => {
  const result = isAllowedOrigin(new Request(requestUrl, {
    method: 'POST',
    headers: { Origin: 'https://attacker.example' }
  }))

  assert.equal(result, false)
})

test('rejects malformed Origin headers', () => {
  const result = isAllowedOrigin(new Request(requestUrl, {
    method: 'DELETE',
    headers: { Origin: 'not-an-origin' }
  }))

  assert.equal(result, false)
})

test('origin comparison includes scheme and port', () => {
  for (const origin of ['http://app.example.test', 'https://app.example.test:444']) {
    const result = isAllowedOrigin(new Request(requestUrl, {
      method: 'POST',
      headers: { Origin: origin }
    }))
    assert.equal(result, false)
  }
})

test('treats the opaque null origin as untrusted', () => {
  assert.equal(isAllowedOrigin(new Request(requestUrl, {
    method: 'POST',
    headers: { Origin: 'null' }
  })), false)
})
