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


test('failed model inference does not mutate memory recency or prune stored memories', async () => {
  const memory = await readFile(path.join(projectDirectory, 'lib', 'memory.ts'), 'utf8')
  const route = await readFile(path.join(projectDirectory, 'app', 'api', 'chat', 'route.ts'), 'utf8')
  const retrieveStart = memory.indexOf('export async function retrieveMemories')
  const retrieveEnd = memory.indexOf('export async function finalizeMemoryTurn', retrieveStart)
  assert.ok(retrieveStart >= 0 && retrieveEnd > retrieveStart)

  const retrieveBody = memory.slice(retrieveStart, retrieveEnd)
  assert.doesNotMatch(retrieveBody, /\.update\(/)
  assert.doesNotMatch(retrieveBody, /pruneMemoryLifecycle\(/)

  const modelPosition = route.indexOf('await qwenChat(modelMessages)')
  const persistencePosition = route.indexOf("adminSupabase.rpc('persist_chat_turn_idempotent_server'")
  const finalizationPosition = route.indexOf('await finalizeMemoryTurn(user.id, memoryIdsToMark)')
  assert.ok(modelPosition >= 0 && persistencePosition > modelPosition)
  assert.ok(finalizationPosition > persistencePosition, 'memory recency/pruning must happen only after the atomic chat commit')
})


test('memory writes revalidate source ownership under the same lock as account deletion', async () => {
  const [memory, migration] = await Promise.all([
    readFile(path.join(projectDirectory, 'lib', 'memory.ts'), 'utf8'),
    readFile(path.join(projectDirectory, 'supabase', 'migrations', '20261026170000_aud_07_storage_and_recovery_hardening.sql'), 'utf8')
  ])

  assert.match(memory, /supabase\.rpc\('persist_my_memory_item'/)
  assert.doesNotMatch(memory, /\.from\('memory_items'\)\s*\.upsert\(/)

  const memoryWriterPosition = migration.indexOf('CREATE OR REPLACE FUNCTION public.persist_my_memory_item')
  const deletionPosition = migration.indexOf('CREATE OR REPLACE FUNCTION public.delete_my_chat_data_server')
  const preferencePosition = migration.toLowerCase().lastIndexOf('create or replace function public.replace_my_memory_preference')
  assert.ok(memoryWriterPosition > 0 && deletionPosition > memoryWriterPosition)
  assert.ok(preferencePosition > 0 && memoryWriterPosition > preferencePosition)

  const sharedLock = /pg_catalog\.pg_advisory_xact_lock\(pg_catalog\.hashtextextended\(v_user_id::text, 0\)\)/
  assert.match(migration.slice(preferencePosition, memoryWriterPosition), sharedLock)
  assert.match(migration.slice(memoryWriterPosition, deletionPosition), sharedLock)
  assert.match(migration.slice(deletionPosition), /pg_catalog\.pg_advisory_xact_lock\(pg_catalog\.hashtextextended\(p_user_id::text, 0\)\)/)
  assert.match(migration.slice(memoryWriterPosition, deletionPosition), /FROM public\.messages[\s\S]*?AND user_id = v_user_id[\s\S]*?AND role = 'user'[\s\S]*?FOR KEY SHARE/)
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.persist_my_memory_item\([\s\S]*?\) FROM PUBLIC, anon/)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.persist_my_memory_item\([\s\S]*?\) TO authenticated/)
})
