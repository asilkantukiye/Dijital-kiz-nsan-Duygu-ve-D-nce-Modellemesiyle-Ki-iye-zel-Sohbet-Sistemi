import assert from 'node:assert/strict'
import test from 'node:test'

import { MEMORY_EMBEDDING_DIMENSION } from '../lib/embedding-validation.ts'
import { normalizeEmbeddingResponse } from '../lib/huggingface.ts'

function vectorAt(index, value) {
  const vector = Array(MEMORY_EMBEDDING_DIMENSION).fill(0)
  vector[index] = value
  return vector
}

test('normalizes a single vector and a one-item batch consistently', () => {
  const source = vectorAt(0, 3)
  source[1] = 4

  const direct = normalizeEmbeddingResponse(source)
  const batched = normalizeEmbeddingResponse([source])

  assert.equal(direct.length, MEMORY_EMBEDDING_DIMENSION)
  assert.ok(Math.abs(direct[0] - 0.6) < 1e-12)
  assert.ok(Math.abs(direct[1] - 0.8) < 1e-12)
  assert.deepEqual(batched, direct)
})

test('mean-pools all token rows from both 2D and one-batch 3D outputs', () => {
  const first = vectorAt(0, 1)
  const second = vectorAt(1, 1)

  const matrix = normalizeEmbeddingResponse([first, second])
  const batchedTokenMatrix = normalizeEmbeddingResponse([[first, second]])
  const expected = 1 / Math.sqrt(2)

  for (const result of [matrix, batchedTokenMatrix]) {
    assert.equal(result.length, MEMORY_EMBEDDING_DIMENSION)
    assert.ok(Math.abs(result[0] - expected) < 1e-12)
    assert.ok(Math.abs(result[1] - expected) < 1e-12)
    assert.ok(result.every(Number.isFinite))
  }
})

test('rejects malformed token rows instead of silently dropping or padding them', () => {
  const good = vectorAt(0, 1)
  const short = Array(MEMORY_EMBEDDING_DIMENSION - 1).fill(1)
  const nonFinite = vectorAt(1, 1)
  nonFinite[7] = Number.NaN

  assert.throws(() => normalizeEmbeddingResponse([good, short]))
  assert.throws(() => normalizeEmbeddingResponse([[good, short]]))
  assert.throws(() => normalizeEmbeddingResponse([good, nonFinite]))
  assert.throws(() => normalizeEmbeddingResponse([[good], [good]]))
})
