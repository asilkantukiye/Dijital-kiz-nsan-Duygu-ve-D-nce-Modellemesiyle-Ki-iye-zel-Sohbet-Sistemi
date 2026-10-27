import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const testDirectory = path.dirname(fileURLToPath(import.meta.url))
const projectDirectory = path.resolve(testDirectory, '..')
const readmePath = path.join(projectDirectory, 'README.md')
const privacyPath = path.join(projectDirectory, 'app', 'privacy', 'page.tsx')
const memoryPath = path.join(projectDirectory, 'lib', 'memory.ts')

test('README and privacy notice disclose scheduled 180-day inactive-memory cleanup while preserving chat history', async () => {
  const [readme, privacy] = await Promise.all([
    readFile(readmePath, 'utf8'),
    readFile(privacyPath, 'utf8')
  ])

  for (const document of [readme, privacy]) {
    assert.match(document, /180 günlük etkin olmama/i)
    assert.match(document, /saatlik/i)
    assert.match(document, /sohbet.*silmez/i)
    assert.doesNotMatch(document, /arka planda zamanlanmış bir iş değildir/i)
    assert.doesNotMatch(document, /hiç geri dönmezse.*otomatik silinmez/i)
  }
})

test('scheduled retention policy removes inactive memories and expired metadata but never purges chat history', async () => {
  const migrationPath = path.join(projectDirectory, 'supabase', 'migrations', '20261027181851_stage6_retention_inactivity_semantics.sql')
  const migration = await readFile(migrationPath, 'utf8')

  assert.match(migration, /candidate\.updated_at < v_cutoff/)
  assert.match(migration, /candidate\.last_used_at IS NULL OR candidate\.last_used_at < v_cutoff/)
  assert.match(migration, /DELETE FROM public\.chat_request_deduplication/)
  assert.match(migration, /DELETE FROM public\.chat_rate_limit_counters/)
  assert.doesNotMatch(migration, /DELETE FROM public\.messages/i)
})

test('memory lifecycle pruning is triggered in authenticated-user memory flows', async () => {
  const memory = await readFile(memoryPath, 'utf8')

  assert.match(memory, /export async function retrieveMemories\([\s\S]*?await pruneMemoryLifecycle\(supabase, userId\)/)
  assert.match(memory, /export async function persistMemories\([\s\S]*?await pruneMemoryLifecycle\(supabase, userId\)/)
  assert.match(memory, /\.eq\('user_id', userId\)/)
})



test('every memory-retention deletion and overflow cleanup is scoped to the current user', async () => {
  const memory = await readFile(memoryPath, 'utf8')

  const neverUsedPrune = memory.match(
    /async function pruneNeverUsedMemories\([\s\S]*?\n\}/
  )
  assert.ok(neverUsedPrune, 'never-used retention helper must remain explicit and bounded')
  assert.match(neverUsedPrune[0], /\.eq\('user_id', userId\)/)
  assert.match(neverUsedPrune[0], /\.is\('last_used_at', null\)/)
  assert.match(neverUsedPrune[0], /\.lt\('updated_at', cutoff\)/)
  assert.match(neverUsedPrune[0], /\.order\('updated_at', \{ ascending: true \}\)/)
  assert.match(neverUsedPrune[0], /\.limit\(MEMORY_PRUNE_BATCH_SIZE\)/)

  const inactivePrune = memory.match(
    /async function pruneInactiveMemories\([\s\S]*?\n\}/
  )
  assert.ok(inactivePrune, 'inactive-memory retention helper must remain explicit and bounded')
  assert.match(inactivePrune[0], /\.eq\('user_id', userId\)/)
  assert.match(inactivePrune[0], /\.not\('last_used_at', 'is', null\)/)
  assert.match(inactivePrune[0], /\.lt\('updated_at', cutoff\)/)
  assert.match(inactivePrune[0], /\.lt\('last_used_at', cutoff\)/)
  assert.match(inactivePrune[0], /\.limit\(MEMORY_PRUNE_BATCH_SIZE\)/)

  const lifecyclePrune = memory.match(
    /async function pruneMemoryLifecycle\([\s\S]*?\n\}/
  )
  assert.ok(lifecyclePrune, 'memory-cap cleanup must remain explicit')
  assert.match(lifecyclePrune[0], /MAX_PRUNE_BATCHES_PER_PASS/)
  assert.match(lifecyclePrune[0], /\.eq\('user_id', userId\)/)
  assert.match(lifecyclePrune[0], /\.order\('updated_at', \{ ascending: false \}\)/)
  assert.match(lifecyclePrune[0], /\.range\(MAX_MEMORY_ITEMS_PER_USER,/)
  assert.match(lifecyclePrune[0], /\.in\('id', ids\)/)
  assert.doesNotMatch(lifecyclePrune[0], /while\s*\(true\)/)
})
