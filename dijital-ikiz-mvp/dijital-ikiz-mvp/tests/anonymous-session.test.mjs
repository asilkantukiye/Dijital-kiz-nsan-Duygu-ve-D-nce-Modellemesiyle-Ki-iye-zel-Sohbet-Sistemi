import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

async function read(relativePath) {
  return readFile(path.join(root, relativePath), 'utf8')
}

test('app creates an anonymous Supabase session instead of asking for login', async () => {
  const page = await read('app/page.tsx')
  assert.match(page, /signInAnonymously\(\)/)
  assert.match(page, /Anonymous Sign-Ins/)
  assert.doesNotMatch(page, /Giriş \/ Kayıt|href=["']\/login/)
  assert.doesNotMatch(page, /onClick=\{signOut\}/)
})

test('legacy login route redirects to the app shell', async () => {
  const page = await read('app/login/page.tsx')
  assert.match(page, /redirect\('\/'\)/)
  assert.doesNotMatch(page, /signInWithPassword|signUp\(/)
})

test('app shell is public but chat APIs remain authenticated', async () => {
  const proxy = await read('lib/supabase-proxy.ts')
  assert.doesNotMatch(proxy, /pathname === '\/'/)
  assert.match(proxy, /pathname\.startsWith\('\/api\/chat'\)/)
  assert.match(proxy, /supabase\.auth\.getUser\(\)/)
  assert.match(proxy, /status: 401/)
})
