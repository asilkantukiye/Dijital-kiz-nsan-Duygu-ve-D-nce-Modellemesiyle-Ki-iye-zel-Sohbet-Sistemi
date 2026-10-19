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

test('README and privacy notice disclose that memory cleanup is not a scheduled background job', async () => {
  const [readme, privacy] = await Promise.all([
    readFile(readmePath, 'utf8'),
    readFile(privacyPath, 'utf8')
  ])

  for (const document of [readme, privacy]) {
    assert.match(document, /arka planda zamanlanmış bir iş değildir/i)
    assert.match(document, /hiç geri dönmezse/i)
    assert.match(document, /otomatik silinmez/i)
  }
})

test('memory lifecycle pruning is triggered in authenticated-user memory flows', async () => {
  const memory = await readFile(memoryPath, 'utf8')

  assert.match(memory, /export async function retrieveMemories\([\s\S]*?await pruneMemoryLifecycle\(supabase, userId\)/)
  assert.match(memory, /export async function persistMemories\([\s\S]*?await pruneMemoryLifecycle\(supabase, userId\)/)
  assert.match(memory, /\.eq\('user_id', userId\)/)
})
