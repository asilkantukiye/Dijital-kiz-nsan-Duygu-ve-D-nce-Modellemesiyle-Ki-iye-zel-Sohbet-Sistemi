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

test('Supabase configuration is validated before SSR client creation', async () => {
  const source = await readProxy()
  assert.ok(source.includes('const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL'))
  assert.ok(source.includes('const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'))
  assert.ok(source.indexOf('if (!supabaseUrl || !supabasePublishableKey)') < source.indexOf('const supabase = createServerClient('))
  assert.ok(source.includes('if (protectedRoute) {\n      return authUnavailableResponse()'))
})

test('public app shell remains available without Supabase; APIs fail closed', async () => {
  const source = await readProxy()
  assert.ok(source.includes("response.headers.set('Cache-Control', 'private, no-store')"))
  assert.ok(source.includes("pathname.startsWith('/api/chat')"))
  assert.ok(source.includes("pathname.startsWith('/api/feedback')"))
  assert.ok(source.includes("pathname.startsWith('/api/data')"))
  assert.ok(!source.includes("pathname === '/'"))
  assert.ok(source.includes("status: 503"))
  assert.ok(source.includes("status: 401"))
})
