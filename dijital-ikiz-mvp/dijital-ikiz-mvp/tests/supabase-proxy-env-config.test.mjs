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

test('missing Supabase configuration is checked before SSR client creation', async () => {
  const source = await readProxy()
  assert.match(source, /const supabaseUrl = process\.env\.NEXT_PUBLIC_SUPABASE_URL/)
  assert.match(source, /const supabasePublishableKey = process\.env\.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/)
  assert.match(source, /if \(!supabaseUrl \|\| !supabasePublishableKey\)[\s\S]*?if \(protectedRoute\)\s*\{\s*return authUnavailableResponse\(\)/)
  assert.ok(source.indexOf('if (!supabaseUrl || !supabasePublishableKey)') < source.indexOf('const supabase = createServerClient('))
})

test('public app shell stays available with private no-store headers when Supabase is missing', async () => {
  const source = await readProxy()
  assert.match(source, /if \(!supabaseUrl \|\| !supabasePublishableKey\)[\s\S]*?response\.headers\.set\('Cache-Control', 'private, no-store'\)\s*return response/)
})

test('API routes stay protected and fail closed without Supabase config', async () => {
  const source = await readProxy()
  assert.match(source, /pathname\.startsWith\('\/api\/chat'\)/)
  assert.match(source, /pathname\.startsWith\('\/api\/feedback'\)/)
  assert.match(source, /pathname\.startsWith\('\/api\/data'\)/)
  assert.doesNotMatch(source, /pathname === '\/'/)
  assert.match(source, /function authUnavailableResponse\(\)/)
  assert.match(source, /status: 503,[\s\S]*?Cache-Control: 'private, no-store'/)
})
