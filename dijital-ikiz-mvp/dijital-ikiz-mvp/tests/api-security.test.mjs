import assert from 'node:assert/strict'
import test from 'node:test'

import { isAllowedOrigin } from '../lib/origin-validation.ts'

const requestUrl = 'https://app.example.test/api/feedback'

test('allows same-origin browser mutations with an Origin header', () => {
  const result = isAllowedOrigin(new Request(requestUrl, {
    method: 'POST',
    headers: { Origin: 'https://app.example.test' }
  }))

  assert.equal(result, true)
})

test('rejects requests missing Origin and any same-origin browser context', () => {
  assert.equal(isAllowedOrigin(new Request(requestUrl, { method: 'POST' })), false)
})

test('allows missing Origin only with an exact same-origin Referer', () => {
  assert.equal(isAllowedOrigin(new Request(requestUrl, {
    method: 'POST',
    headers: { Referer: 'https://app.example.test/settings' }
  })), true)

  assert.equal(isAllowedOrigin(new Request(requestUrl, {
    method: 'POST',
    headers: { Referer: 'https://attacker.example/form' }
  })), false)

  assert.equal(isAllowedOrigin(new Request(requestUrl, {
    method: 'POST',
    headers: { Referer: 'malformed-url' }
  })), false)
})

test('allows missing Origin when Fetch Metadata explicitly reports same-origin', () => {
  assert.equal(isAllowedOrigin(new Request(requestUrl, {
    method: 'POST',
    headers: { 'Sec-Fetch-Site': 'same-origin' }
  })), true)

  assert.equal(isAllowedOrigin(new Request(requestUrl, {
    method: 'POST',
    headers: { 'Sec-Fetch-Site': 'cross-site' }
  })), false)
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
