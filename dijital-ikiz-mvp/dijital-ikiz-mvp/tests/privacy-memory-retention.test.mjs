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

test('README distinguishes pending scheduled cleanup from current production behavior', async () => {
  const [readme, privacy] = await Promise.all([
    readFile(readmePath, 'utf8'),
    readFile(privacyPath, 'utf8')
  ])

  assert.match(readme, /20261023193000_stage5_1_memory_retention_cron\.sql/)
  assert.match(readme, /Migration uygulanana kadar mevcut üretim davranışı/i)
  assert.match(readme, /hiç geri dönmezse/i)
  assert.match(readme, /otomatik silinmez/i)

  // The privacy page describes the actually deployed app, not a draft branch.
  assert.match(privacy, /arka planda zamanlanmış bir iş değildir/i)
  assert.match(privacy, /hiç geri dönmezse/i)
  assert.match(privacy, /otomatik silinmez/i)
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
    /const \{ error: neverUsedError \} = await supabase([\s\S]*?)if \(neverUsedError\) throw neverUsedError/
  )
  assert.ok(neverUsedPrune, 'never-used retention query must remain explicit')
  assert.match(neverUsedPrune[1], /\.eq\('user_id', userId\)/)
  assert.match(neverUsedPrune[1], /\.is\('last_used_at', null\)/)
  assert.match(neverUsedPrune[1], /\.lt\('updated_at', cutoff\)/)

  const inactivePrune = memory.match(
    /const \{ error: inactiveError \} = await supabase([\s\S]*?)if \(inactiveError\) throw inactiveError/
  )
  assert.ok(inactivePrune, 'inactive-memory retention query must remain explicit')
  assert.match(inactivePrune[1], /\.eq\('user_id', userId\)/)
  assert.match(inactivePrune[1], /\.not\('last_used_at', 'is', null\)/)
  assert.match(inactivePrune[1], /\.lt\('updated_at', cutoff\)/)
  assert.match(inactivePrune[1], /\.lt\('last_used_at', cutoff\)/)

  const overflowSelect = memory.match(
    /while \(true\) \{([\s\S]*?)if \(error\) throw error/
  )
  assert.ok(overflowSelect, 'memory-cap query must remain explicit')
  assert.match(overflowSelect[1], /\.eq\('user_id', userId\)/)
  assert.match(overflowSelect[1], /\.order\('updated_at', \{ ascending: false \}\)/)
  assert.match(overflowSelect[1], /\.range\(MAX_MEMORY_ITEMS_PER_USER,/)

  const overflowDelete = memory.match(
    /const \{ error: deleteError \} = await supabase([\s\S]*?)if \(deleteError\) throw deleteError/
  )
  assert.ok(overflowDelete, 'overflow deletion query must remain explicit')
  assert.match(overflowDelete[1], /\.eq\('user_id', userId\)/)
  assert.match(overflowDelete[1], /\.in\('id', ids\)/)
})
