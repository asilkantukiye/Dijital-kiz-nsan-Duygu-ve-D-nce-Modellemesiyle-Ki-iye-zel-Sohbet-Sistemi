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
  assert.ok(source.includes('await supabase.auth.getClaims()'))
  assert.ok(source.includes("response.headers.set('Cache-Control', 'private, no-store')"))
})

test('getUser failures deny protected API routes', async () => {
  const source = await readProxy()
  assert.ok(source.includes('await supabase.auth.getUser()'))
  assert.ok(source.includes('return unauthenticatedResponse()'))
  assert.ok(source.includes('if (!hasAuthenticatedUser)'))
})

test('no login redirect is present and API denials are non-cacheable', async () => {
  const source = await readProxy()
  assert.ok(source.includes('function unauthenticatedResponse()'))
  assert.ok(!source.includes('loginRedirect'))
  assert.ok(!source.includes('NextResponse.redirect'))
  assert.ok(source.includes("status: 401, headers: { 'Cache-Control': 'private, no-store' }"))
})
