import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const testDirectory = path.dirname(fileURLToPath(import.meta.url))
const proxyPath = path.resolve(testDirectory, '../lib/supabase-proxy.ts')

async function readProxy() {
  return readFile(proxyPath, 'utf8')
}

test('a claims/network error does not crash the public app shell', async () => {
  const source = await readProxy()
  assert.match(source, /try\s*\{\s*await supabase\.auth\.getClaims\(\)\s*\}\s*catch/)
  assert.match(source, /if \(protectedRoute\)\s*\{\s*return unauthenticatedResponse\(\)\s*\}\s*response\.headers\.set\('Cache-Control', 'private, no-store'\)\s*return response/)
})

test('a thrown getUser/network error fails closed for API routes', async () => {
  const source = await readProxy()
  assert.match(source, /await supabase\.auth\.getUser\(\)/)
  assert.match(source, /catch\s*\{\s*return unauthenticatedResponse\(\)/)
  assert.match(source, /if \(!hasAuthenticatedUser\)\s*\{\s*return unauthenticatedResponse\(\)/)
})

test('the public app shell has no login redirect and API denials are non-cacheable', async () => {
  const source = await readProxy()
  assert.match(source, /function unauthenticatedResponse\(\)/)
  assert.doesNotMatch(source, /loginRedirect|NextResponse\.redirect/)
  assert.match(source, /status: 401,[\s\S]*?Cache-Control: 'private, no-store'/)
})
