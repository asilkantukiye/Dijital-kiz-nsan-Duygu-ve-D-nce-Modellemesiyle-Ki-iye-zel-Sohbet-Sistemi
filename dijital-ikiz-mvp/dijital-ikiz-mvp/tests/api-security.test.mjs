import assert from 'node:assert/strict'
import test from 'node:test'

import { rejectCrossOrigin } from '../lib/api-security.ts'

const requestUrl = 'https://app.example.test/api/feedback'

test('allows same-origin browser mutations', () => {
  const result = rejectCrossOrigin(new Request(requestUrl, {
    method: 'POST',
    headers: { Origin: 'https://app.example.test' }
  }))

  assert.equal(result, null)
})

test('allows requests with no Origin header for non-browser clients by policy', () => {
  const result = rejectCrossOrigin(new Request(requestUrl, { method: 'POST' }))
  assert.equal(result, null)
})

test('rejects requests from another origin with no-store response', async () => {
  const result = rejectCrossOrigin(new Request(requestUrl, {
    method: 'POST',
    headers: { Origin: 'https://attacker.example' }
  }))

  assert.ok(result)
  assert.equal(result.status, 403)
  assert.equal(result.headers.get('cache-control'), 'no-store')
  assert.deepEqual(await result.json(), { error: 'Geçersiz istek kaynağı.' })
})

test('rejects malformed Origin headers', () => {
  const result = rejectCrossOrigin(new Request(requestUrl, {
    method: 'DELETE',
    headers: { Origin: 'not-an-origin' }
  }))

  assert.ok(result)
  assert.equal(result.status, 403)
})

test('origin comparison includes scheme and port', () => {
  for (const origin of ['http://app.example.test', 'https://app.example.test:444']) {
    const result = rejectCrossOrigin(new Request(requestUrl, {
      method: 'POST',
      headers: { Origin: origin }
    }))
    assert.ok(result)
    assert.equal(result.status, 403)
  }
})
