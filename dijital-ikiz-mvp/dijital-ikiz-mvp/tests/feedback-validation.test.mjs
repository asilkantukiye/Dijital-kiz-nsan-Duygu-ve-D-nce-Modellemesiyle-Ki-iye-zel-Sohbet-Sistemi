import assert from 'node:assert/strict'
import test from 'node:test'

import { validateFeedbackPayload } from '../lib/feedback-validation.ts'

const messageId = '2bbf44a3-3ccd-4f43-a982-a87ca6dcf0b6'

test('accepts a valid numeric rating and normalizes a comment', () => {
  const result = validateFeedbackPayload({
    messageId,
    rating: 4,
    variant: 'personalized',
    comment: '  Çok faydalı.  '
  })

  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.deepEqual(result.value, {
    messageId,
    rating: 4,
    variant: 'personalized',
    comment: 'Çok faydalı.'
  })
})

test('accepts both supported variants and null comments', () => {
  const result = validateFeedbackPayload({
    messageId,
    rating: 1,
    variant: 'baseline',
    comment: null
  })

  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.value.variant, 'baseline')
  assert.equal(result.value.comment, null)
})

test('rejects ratings supplied as strings', () => {
  const result = validateFeedbackPayload({
    messageId,
    rating: '5',
    variant: 'baseline'
  })

  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.error, /tam sayı/)
})

test('rejects booleans, null, fractions, and out-of-range ratings', () => {
  for (const rating of [true, false, null, 1.5, 0, 6, [], {}]) {
    const result = validateFeedbackPayload({
      messageId,
      rating,
      variant: 'baseline'
    })
    assert.equal(result.ok, false, `rating rejected: ${String(rating)}`)
  }
})

test('rejects malformed message identifiers before any database request', () => {
  for (const invalidId of ['', '[object Object]', 'not-a-uuid', 123, null]) {
    const result = validateFeedbackPayload({
      messageId: invalidId,
      rating: 3,
      variant: 'personalized'
    })
    assert.equal(result.ok, false)
  }
})

test('rejects unsupported variants', () => {
  const result = validateFeedbackPayload({
    messageId,
    rating: 3,
    variant: 'admin'
  })

  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.error, /varyant/)
})

test('rejects comments with incorrect type or excessive length', () => {
  for (const comment of [42, true, {}, Array.from('bad'), 'x'.repeat(1001)]) {
    const result = validateFeedbackPayload({
      messageId,
      rating: 3,
      variant: 'personalized',
      comment
    })
    assert.equal(result.ok, false)
  }
})

test('converts a whitespace-only comment into null', () => {
  const result = validateFeedbackPayload({
    messageId,
    rating: 3,
    variant: 'personalized',
    comment: '   '
  })

  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.value.comment, null)
})

test('rejects null, arrays, and primitive request bodies', () => {
  for (const body of [null, [], 'text', 10, false]) {
    assert.equal(validateFeedbackPayload(body).ok, false)
  }
})
