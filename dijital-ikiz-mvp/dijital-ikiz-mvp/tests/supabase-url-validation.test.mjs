import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { isValidSupabaseUrl } from '../lib/supabase-url.ts'

const testDirectory = path.dirname(fileURLToPath(import.meta.url))
const proxyPath = path.resolve(testDirectory, '../lib/supabase-proxy.ts')

test('valid HTTPS Supabase URLs and loopback HTTP development URLs are accepted', () => {
  assert.equal(isValidSupabaseUrl('https://project-ref.supabase.co'), true)
  assert.equal(isValidSupabaseUrl('https://supabase.example.com/custom-root'), true)
  assert.equal(isValidSupabaseUrl('http://localhost:54321'), true)
  assert.equal(isValidSupabaseUrl('http://127.0.0.1:54321'), true)
  assert.equal(isValidSupabaseUrl('http://[::1]:54321'), true)
})

test('malformed or unsafe Supabase URLs are rejected', () => {
  for (const value of [
    undefined,
    null,
    '',
    '   ',
    'not a URL',
    'ftp://project-ref.supabase.co',
    'http://supabase.example.com',
    'https://user:password@project-ref.supabase.co',
    'https://project-ref.supabase.co?unexpected=value',
    'https://project-ref.supabase.co#fragment'
  ]) {
    assert.equal(isValidSupabaseUrl(value), false, `expected URL to be rejected: ${String(value)}`)
  }
})

test('invalid Supabase URLs are rejected before SDK construction without opening protected routes', async () => {
  const source = await readFile(proxyPath, 'utf8')
  const validationIndex = source.indexOf('if (!isValidSupabaseUrl(supabaseUrl))')
  const clientIndex = source.indexOf('const supabase = createServerClient(')

  assert.ok(validationIndex >= 0, 'proxy must validate the Supabase URL')
  assert.ok(clientIndex > validationIndex, 'URL validation must run before SDK client construction')
  assert.match(
    source,
    /if \(!isValidSupabaseUrl\(supabaseUrl\)\)\s*\{\s*if \(protectedRoute\)\s*\{\s*return authUnavailableResponse\(request, pathname\)/
  )
  assert.match(
    source,
    /if \(!isValidSupabaseUrl\(supabaseUrl\)\)[\s\S]*?response\.headers\.set\('Cache-Control', 'private, no-store'\)\s*return response/
  )
})


test('server and browser Supabase clients validate public environment before SDK construction', async () => {
  const [serverClient, browserClient] = await Promise.all([
    readFile(path.resolve(testDirectory, '../lib/supabase-server.ts'), 'utf8'),
    readFile(path.resolve(testDirectory, '../lib/supabase-browser.ts'), 'utf8')
  ])

  for (const source of [serverClient, browserClient]) {
    const validationIndex = source.indexOf('if (typeof supabaseUrl !== \'string\' || !isValidSupabaseUrl(supabaseUrl) || typeof publishableKey !== \'string\' || !publishableKey.trim())')
    const constructorIndex = source.indexOf('createServerClient(') >= 0
      ? source.indexOf('createServerClient(')
      : source.indexOf('createBrowserClient(')

    assert.ok(validationIndex >= 0, 'Supabase clients must explicitly validate URL and publishable key')
    assert.ok(constructorIndex > validationIndex, 'configuration validation must precede SDK construction')
    assert.doesNotMatch(source, /NEXT_PUBLIC_[A-Z0-9_]+!/)
  }
})


test('privileged Supabase client validates URL and server-only secret before SDK construction', async () => {
  const source = await readFile(path.resolve(testDirectory, '../lib/supabase-admin.ts'), 'utf8')
  const validationIndex = source.indexOf("if (typeof url !== 'string' || !isValidSupabaseUrl(url))")
  const keyValidationIndex = source.indexOf("if (typeof serviceRoleKey !== 'string' || !serviceRoleKey.trim())")
  const constructorIndex = source.indexOf('createSupabaseClient(')
  assert.ok(validationIndex >= 0, 'admin client must validate its URL')
  assert.ok(keyValidationIndex > validationIndex, 'admin client must validate a non-empty server-only key')
  assert.ok(constructorIndex > keyValidationIndex, 'SDK construction must follow all configuration checks')
  assert.match(source, /process\.env\.SUPABASE_SERVICE_ROLE_KEY/)
  assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY\s*:\s*process\.env\.NEXT_PUBLIC_/)
  assert.doesNotMatch(source, /createSupabaseClient\(url!,/)
})
