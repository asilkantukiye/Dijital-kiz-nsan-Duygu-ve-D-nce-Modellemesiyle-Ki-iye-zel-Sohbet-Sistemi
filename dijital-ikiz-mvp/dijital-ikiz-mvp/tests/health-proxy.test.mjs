import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const testDirectory = path.dirname(fileURLToPath(import.meta.url))
const projectDirectory = path.resolve(testDirectory, '..')

test('/api/health and its protected deep endpoint are excluded from the Supabase session proxy matcher', async () => {
  const proxy = await readFile(path.join(projectDirectory, 'proxy.ts'), 'utf8')
  const matcher = proxy.match(/matcher:\s*\[([\s\S]*?)\]/)

  assert.ok(matcher, 'proxy matcher configuration must exist')
  assert.match(matcher[1], /api\/health\|_next\/static/)
  assert.match(matcher[1], /\(\?!/)
  assert.doesNotMatch(matcher[1], /api\/health\/\?\$\|_next\/static/)
})

test('public liveness health route remains cache-disabled and does not call Supabase directly', async () => {
  const route = await readFile(path.join(projectDirectory, 'app/api/health/route.ts'), 'utf8')

  assert.match(route, /Cache-Control': 'no-store'/)
  assert.match(route, /buildHealthStatus\(/)
  assert.doesNotMatch(route, /createClient\(|auth\.getUser\(|auth\.getClaims\(/)
})

test('deep health route uses a protected header and never returns provider credentials', async () => {
  const route = await readFile(path.join(projectDirectory, 'app/api/health/deep/route.ts'), 'utf8')

  assert.match(route, /x-healthcheck-token/)
  assert.match(route, /isAuthorizedHealthcheck\(/)
  assert.match(route, /status: result\.ok \? 200 : 503/)
  assert.match(route, /Cache-Control': 'no-store'/)
  assert.doesNotMatch(route, /console\.(?:log|error).*Token/i)
})
