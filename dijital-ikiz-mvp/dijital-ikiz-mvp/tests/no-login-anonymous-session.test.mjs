import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('home starts an anonymous session and exposes no login form', async () => {
  const page = await readFile(path.join(root, 'app/page.tsx'), 'utf8')
  const login = await readFile(path.join(root, 'app/login/page.tsx'), 'utf8')

  assert.match(page, /signInAnonymously\(\)/)
  assert.match(page, /Hesap açmadan anonim araştırma oturumu/)
  assert.doesNotMatch(page, /type="password"/i)
  assert.doesNotMatch(page, /signInWithPassword/)
  assert.match(login, /redirect\('\/'\)/)
})

test('chat API still verifies the server-side anonymous session', async () => {
  const route = await readFile(path.join(root, 'app/api/chat/route.ts'), 'utf8')
  const proxy = await readFile(path.join(root, 'lib/supabase-proxy.ts'), 'utf8')

  assert.match(route, /supabase\.auth\.getUser\(\)/)
  assert.match(route, /if \(!user\)/)
  assert.match(proxy, /supabase\.auth\.getUser\(\)/)
  assert.match(proxy, /status: 401/)
})
