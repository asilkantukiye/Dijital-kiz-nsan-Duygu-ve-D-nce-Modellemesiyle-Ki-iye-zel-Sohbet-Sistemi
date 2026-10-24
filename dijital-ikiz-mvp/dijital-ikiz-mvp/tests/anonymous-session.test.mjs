import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

async function read(relativePath) {
  return readFile(path.join(root, relativePath), 'utf8')
}

test('app creates an anonymous Supabase session without login UI', async () => {
  const page = await read('app/page.tsx')
  assert.ok(page.includes('signInAnonymously()'))
  assert.ok(page.includes('Anonymous Sign-Ins'))
  assert.ok(!page.includes('Giriş / Kayıt'))
  assert.ok(!page.includes('href="/login"'))
  assert.ok(!page.includes('onClick={signOut}'))
})

test('legacy login route redirects to the app shell', async () => {
  const page = await read('app/login/page.tsx')
  assert.ok(page.includes("redirect('/')"))
  assert.ok(!page.includes('signInWithPassword'))
  assert.ok(!page.includes('signUp('))
})

test('app shell is public but chat APIs remain authenticated', async () => {
  const proxy = await read('lib/supabase-proxy.ts')
  assert.ok(!proxy.includes("pathname === '/'"))
  assert.ok(proxy.includes("pathname.startsWith('/api/chat')"))
  assert.ok(proxy.includes('supabase.auth.getUser()'))
  assert.ok(proxy.includes('status: 401'))
})
