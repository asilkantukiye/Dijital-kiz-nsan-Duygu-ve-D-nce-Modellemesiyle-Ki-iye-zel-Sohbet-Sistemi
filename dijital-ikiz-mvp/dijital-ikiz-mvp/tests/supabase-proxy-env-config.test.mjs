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

test('missing Supabase configuration is checked before creating the SSR client', async () => {
  const source = await readProxy()

  assert.match(source, /const supabaseUrl = process\.env\.NEXT_PUBLIC_SUPABASE_URL/)
  assert.match(source, /const supabasePublishableKey = process\.env\.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/)
  assert.match(
    source,
    /if \(!supabaseUrl \|\| !supabasePublishableKey\)\s*\{[\s\S]*?if \(protectedRoute\)\s*\{\s*return authUnavailableResponse()/
  )
  assert.ok(
    source.indexOf('if (!supabaseUrl || !supabasePublishableKey)') <
      source.indexOf('const supabase = createServerClient('),
    'environment validation must run before Supabase client construction'
  )
})

test('public pages continue with private no-store when Supabase configuration is missing', async () => {
  const source = await readProxy()

  assert.match(
    source,
    /if \(!supabaseUrl \|\| !supabasePublishableKey\)[\s\S]*?response\.headers\.set\('Cache-Control', 'private, no-store'\)\s*return response/
  )
})

test('protected API requests fail closed with 503 when auth is not configured', async () => {
  const source = await readProxy()

  assert.match(source, /function authUnavailableResponse()/)
  assert.match(source, /status: 503,[\s\S]*?headers: \{ 'Cache-Control': 'private, no-store' \}/)
  assert.match(source, /Kimlik doğrulama hizmeti yapılandırılmamış/)
})
