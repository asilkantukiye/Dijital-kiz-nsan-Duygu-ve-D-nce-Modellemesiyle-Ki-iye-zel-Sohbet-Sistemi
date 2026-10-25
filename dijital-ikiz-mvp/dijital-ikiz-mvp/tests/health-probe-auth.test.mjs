import assert from 'node:assert/strict'
import test from 'node:test'

import { isAuthorizedHealthcheck } from '../lib/health-probe-auth.ts'

test('requires a configured secret of at least 32 characters', () => {
  assert.equal(isAuthorizedHealthcheck(undefined, 'x'.repeat(40)), false)
  assert.equal(isAuthorizedHealthcheck('x'.repeat(31), 'x'.repeat(31)), false)
  assert.equal(isAuthorizedHealthcheck('x'.repeat(32), null), false)
  assert.equal(isAuthorizedHealthcheck('x'.repeat(32), ''), false)
})

test('accepts an exact secret and rejects wrong or different-length values', () => {
  const secret = '0123456789abcdef0123456789abcdef'
  assert.equal(isAuthorizedHealthcheck(secret, secret), true)
  assert.equal(isAuthorizedHealthcheck(secret, secret + 'x'), false)
  assert.equal(isAuthorizedHealthcheck(secret, secret.slice(1)), false)
  assert.equal(isAuthorizedHealthcheck(secret, 'x'.repeat(secret.length)), false)
})
