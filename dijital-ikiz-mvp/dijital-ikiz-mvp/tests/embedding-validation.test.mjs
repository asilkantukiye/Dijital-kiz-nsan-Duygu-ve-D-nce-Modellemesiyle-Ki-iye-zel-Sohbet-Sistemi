import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { MEMORY_EMBEDDING_DIMENSION, validateEmbeddingVector } from '../lib/embedding-validation.ts'

const testDirectory = path.dirname(fileURLToPath(import.meta.url))
const projectDirectory = path.resolve(testDirectory, '..')

test('accepts a finite non-zero vector and returns a unit-normalized vector', () => {
  const source = Array(MEMORY_EMBEDDING_DIMENSION).fill(0)
  source[0] = 3
  source[1] = 4
  const vector = validateEmbeddingVector(source)
  assert.equal(vector.length, MEMORY_EMBEDDING_DIMENSION)
  assert.ok(Math.abs(vector[0] - 0.6) < 1e-12)
  assert.ok(Math.abs(vector[1] - 0.8) < 1e-12)
  assert.ok(vector.every(Number.isFinite))
  assert.ok(Math.abs(Math.hypot(...vector) - 1) < 1e-12)
})

test('rejects empty, null, malformed, wrong-dimension, and zero vectors', () => {
  for (const value of [null, undefined, [], {}, 'vector', Array(MEMORY_EMBEDDING_DIMENSION - 1).fill(1), Array(MEMORY_EMBEDDING_DIMENSION + 1).fill(1), Array(MEMORY_EMBEDDING_DIMENSION).fill(0)]) {
    assert.throws(() => validateEmbeddingVector(value))
  }
})

test('rejects nulls, strings, NaN, infinity, and overflowing norms without coercion', () => {
  for (const invalid of [null, '1', Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    const source = Array(MEMORY_EMBEDDING_DIMENSION).fill(0)
    source[0] = invalid
    assert.throws(() => validateEmbeddingVector(source))
  }
  const overflowing = Array(MEMORY_EMBEDDING_DIMENSION).fill(1e308)
  assert.throws(() => validateEmbeddingVector(overflowing))
})

test('all embedding write/query paths validate provider output and memory pruning is bounded', async () => {
  const memory = await readFile(path.join(projectDirectory, 'lib/memory.ts'), 'utf8')
  const provider = await readFile(path.join(projectDirectory, 'lib/huggingface.ts'), 'utf8')
  const validator = await readFile(path.join(projectDirectory, 'lib/embedding-validation.ts'), 'utf8')

  assert.match(memory, /validateEmbeddingVector\(await embedder\.embed\(queryText, 'query'\)\)/)
  assert.match(memory, /validateEmbeddingVector\(await embedder\.embed\(memory\.content, 'passage'\)\)/)
  assert.match(provider, /return normalizeEmbeddingResponse\(result\)/)
  assert.match(provider, /export function normalizeEmbeddingResponse/)
  assert.match(provider, /function poolTokenRows/)
  assert.match(provider, /!Number\.isFinite\(item\)/)
  assert.match(validator, /typeof item !== 'number' \|\| !Number\.isFinite\(item\)/)

  assert.match(memory, /const MAX_PRUNE_BATCHES_PER_PASS = 4/)
  assert.match(memory, /const MAX_PRUNE_FILTER_CLAUSES = 64/)
  assert.match(memory, /\.select\('id,updated_at,last_used_at'\)/)
  assert.match(memory, /last_used_at\.eq\.\$\{row\.last_used_at\}/)
  assert.match(memory, /last_used_at\.is\.null/)
  assert.match(memory, /\.or\(updatedSnapshotFilter\)/)
  assert.match(memory, /\.limit\(MEMORY_PRUNE_BATCH_SIZE\)/)
  assert.match(memory, /\.is\('last_used_at', null\)\.lt\('updated_at', cutoff\)/)
  assert.match(memory, /\.not\('last_used_at', 'is', null\)\.lt\('updated_at', cutoff\)\.lt\('last_used_at', cutoff\)/)
  assert.doesNotMatch(memory, /while\s*\(true\)/)
})
