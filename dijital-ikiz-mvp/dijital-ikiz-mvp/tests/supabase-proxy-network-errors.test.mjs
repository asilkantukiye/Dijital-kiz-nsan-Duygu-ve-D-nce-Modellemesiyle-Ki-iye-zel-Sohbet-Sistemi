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

test('a thrown claims/network error does not crash public routes', async () => {
  const source = await readProxy()

  assert.match(source, /try\s*\{\s*await supabase\.auth\.getClaims\(\)\s*\}\s*catch/)
  assert.match(
    source,
    /catch\s*\{\s*if \(protectedRoute\) \{\s*return unauthenticatedResponse\(request, pathname\)\s*\}\s*response\.headers\.set\('Cache-Control', 'private, no-store'\)\s*return response/
  )
})

test('a thrown getUser/network error fails closed for protected routes', async () => {
  const source = await readProxy()

  assert.match(source, /try\s*\{[\s\S]*?await supabase\.auth\.getUser\(\)[\s\S]*?\}\s*catch\s*\{[\s\S]*?return unauthenticatedResponse\(request, pathname\)/)
  assert.match(source, /if \(!hasAuthenticatedUser\)\s*\{\s*return unauthenticatedResponse\(request, pathname\)/)
})

test('unauthenticated page redirects and API denials are non-cacheable', async () => {
  const source = await readProxy()

  assert.match(source, /function unauthenticatedResponse\(request: NextRequest, pathname: string\)/)
  assert.match(source, /NextResponse\.redirect\(loginUrl\)[\s\S]*?Cache-Control', 'private, no-store'/)
  assert.match(source, /status: 401,[\s\S]*?headers: \{ 'Cache-Control': 'private, no-store' \}/)
})
