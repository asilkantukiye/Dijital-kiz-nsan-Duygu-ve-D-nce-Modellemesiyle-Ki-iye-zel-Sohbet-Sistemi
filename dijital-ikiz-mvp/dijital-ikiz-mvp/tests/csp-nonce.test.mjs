import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { createCspRequestContext } from '../lib/csp.ts'

const testDirectory = path.dirname(fileURLToPath(import.meta.url))
const projectDirectory = path.resolve(testDirectory, '..')

test('creates a distinct valid nonce and a restrictive production policy per request', () => {
  const first = createCspRequestContext('https://project.example.supabase.co', 'production')
  const second = createCspRequestContext('https://project.example.supabase.co', 'production')

  assert.notEqual(first.nonce, second.nonce)
  assert.match(first.nonce, /^[A-Za-z0-9+/]+={0,2}$/)
  assert.match(first.policy, /default-src 'self'/)
  assert.match(first.policy, /object-src 'none'/)
  assert.match(first.policy, /frame-ancestors 'none'/)
  assert.match(first.policy, /base-uri 'self'/)
  assert.match(first.policy, /form-action 'self'/)
  assert.match(first.policy, /script-src 'self' 'nonce-[^']+' 'strict-dynamic'/)
  assert.doesNotMatch(first.policy, /script-src[^;]*'unsafe-inline'/)
  assert.doesNotMatch(first.policy, /script-src[^;]*'unsafe-eval'/)
  assert.match(first.policy, /style-src-attr 'unsafe-inline'/)
  assert.match(first.policy, /upgrade-insecure-requests/)
})

test('allows the configured Supabase REST origin and its WebSocket origin only', () => {
  const csp = createCspRequestContext('https://yaryteseqvmyvapyppmy.supabase.co', 'production').policy

  assert.match(csp, /connect-src 'self' https:\/\/yaryteseqvmyvapyppmy\.supabase\.co wss:\/\/yaryteseqvmyvapyppmy\.supabase\.co/)
  assert.doesNotMatch(csp, /https:\/\/router\.huggingface\.co/)
  assert.doesNotMatch(csp, /wss:\/\/attacker\.example/)
})

test('rejects malformed or credential-bearing Supabase origins from connect-src', () => {
  for (const invalidUrl of [
    'https://user:pass@attacker.example',
    'https://attacker.example/?token=hidden',
    'javascript:alert(1)',
    'not-a-url'
  ]) {
    const csp = createCspRequestContext(invalidUrl, 'production').policy
    assert.doesNotMatch(csp, /connect-src[^;]*attacker\.example/)
  }
})

test('development permits only local dev WebSockets and does not force HTTPS upgrades', () => {
  const csp = createCspRequestContext('http://127.0.0.1:54321', 'development').policy

  assert.match(csp, /http:\/\/127\.0\.0\.1:54321/)
  assert.match(csp, /ws:\/\/127\.0\.0\.1:54321/)
  assert.match(csp, /ws:\/\/localhost:3000/)
  assert.doesNotMatch(csp, /upgrade-insecure-requests/)
})

test('proxy forwards nonce CSP to Next.js and adds the policy to every returned response', async () => {
  const [proxy, sessionProxy] = await Promise.all([
    readFile(path.join(projectDirectory, 'proxy.ts'), 'utf8'),
    readFile(path.join(projectDirectory, 'lib', 'supabase-proxy.ts'), 'utf8')
  ])

  assert.match(proxy, /createCspRequestContext\(/)
  assert.match(proxy, /await updateSession\(request, context\)/)
  assert.match(proxy, /response\.headers\.set\('Content-Security-Policy', context\.policy\)/)
  assert.match(sessionProxy, /requestHeaders\.set\('x-nonce', security\.nonce\)/)
  assert.match(sessionProxy, /requestHeaders\.set\('Content-Security-Policy', security\.policy\)/)
  assert.match(sessionProxy, /NextResponse\.next\(\{ request: \{ headers: requestHeaders \} \}\)/)
  assert.match(sessionProxy, /response = continueRequest\(\)/)
})

test('CSP nonce security does not expose the nonce as a response header', async () => {
  const proxy = await readFile(path.join(projectDirectory, 'proxy.ts'), 'utf8')
  assert.doesNotMatch(proxy, /response\.headers\.set\(['"]x-nonce['"]/)
})
