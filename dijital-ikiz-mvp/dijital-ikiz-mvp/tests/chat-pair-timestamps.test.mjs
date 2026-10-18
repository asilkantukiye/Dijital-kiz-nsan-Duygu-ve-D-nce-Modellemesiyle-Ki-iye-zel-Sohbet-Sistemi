import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const testDirectory = path.dirname(fileURLToPath(import.meta.url))
const routePath = path.resolve(testDirectory, '..', 'app', 'api', 'chat', 'route.ts')

test('chat rows persist strictly ordered timestamps for paired export', async () => {
  const route = await readFile(routePath, 'utf8')

  assert.match(route, /const userMessageCreatedAt = new Date\(\)\.toISOString\(\)/)
  assert.match(route, /const assistantTimestamp = Math\.max\(/)
  assert.match(route, /created_at: userMessageCreatedAt/)
  assert.match(route, /created_at: assistantMessageCreatedAt/)
})
