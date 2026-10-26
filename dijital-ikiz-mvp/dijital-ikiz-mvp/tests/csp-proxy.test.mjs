import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const here = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.resolve(here, '..')

test('production proxy creates a per-request CSP nonce and forwards the policy', async () => {
  const proxy = await readFile(path.join(appRoot, 'proxy.ts'), 'utf8')
  const sessionProxy = await readFile(path.join(appRoot, 'lib', 'supabase-proxy.ts'), 'utf8')

  assert.match(proxy, /createCspNonce\(\)/)
  assert.match(proxy, /buildContentSecurityPolicy\(nonce, true\)/)
  assert.match(proxy, /'x-nonce': nonce/)
  assert.match(proxy, /'Content-Security-Policy': policy/)
  assert.match(proxy, /response\.headers\.set\('Content-Security-Policy', policy\)/)
  assert.match(sessionProxy, /requestHeaderOverrides\?: HeadersInit/)
  assert.match(sessionProxy, /new Headers\(request\.headers\)/)
  assert.match(sessionProxy, /headers\.set\(key, value\)/)
  assert.match(sessionProxy, /response = createResponse\(\)/)
})
