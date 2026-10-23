import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { validateChatPayload } from '../lib/chat-validation.ts'

const testDirectory = path.dirname(fileURLToPath(import.meta.url))
const appDirectory = path.resolve(testDirectory, '..')

test('unauthenticated chat requests are rejected before the body is parsed', async () => {
  const route = await readFile(path.join(appDirectory, 'app/api/chat/route.ts'), 'utf8')
  const authIndex = route.indexOf('supabase.auth.getUser()')
  const rejectionIndex = route.indexOf("if (!user)")
  const bodyIndex = route.indexOf('readJsonBodyLimited(req, 16 * 1024)')

  assert.notEqual(authIndex, -1)
  assert.notEqual(rejectionIndex, -1)
  assert.notEqual(bodyIndex, -1)
  assert.ok(authIndex < rejectionIndex, 'auth.getUser must precede the 401 guard')
  assert.ok(rejectionIndex < bodyIndex, 'the 401 guard must run before body parsing')
  assert.match(route, /status: 401, headers: \{ 'Cache-Control': 'no-store' \}/)
})

test('request body cannot choose a user or session identity', () => {
  for (const payload of [
    { message: 'Hi', variant: 'personalized', user_id: 'victim' },
    { message: 'Hi', variant: 'personalized', userId: 'victim' },
    { message: 'Hi', variant: 'personalized', session_id: 'forged' },
    { message: 'Hi', variant: 'personalized', sessionId: 'forged' }
  ]) {
    const result = validateChatPayload(payload)
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.status, 400)
  }
})

test('server persistence derives the user id from auth and calls only the server RPC', async () => {
  const route = await readFile(path.join(appDirectory, 'app/api/chat/route.ts'), 'utf8')
  const adminClient = await readFile(path.join(appDirectory, 'lib/supabase-admin.ts'), 'utf8')
  const migration = await readFile(
    path.join(appDirectory, 'supabase/migrations/20261023196000_aud_01_chat_write_boundary.sql'),
    'utf8'
  )
  const sqlTest = await readFile(
    path.join(appDirectory, 'tests/sql/chat_write_boundary.integration.sql'),
    'utf8'
  )

  assert.match(route, /adminSupabase\.rpc\('persist_chat_turn_server'/)
  assert.match(route, /p_user_id:\s*user\.id/)
  assert.doesNotMatch(route, /bodyResult\.value\.(?:user_id|userId|session_id|sessionId)/)
  assert.match(adminClient, /import 'server-only'/)
  assert.match(adminClient, /process\.env\.SUPABASE_SERVICE_ROLE_KEY/)
  assert.doesNotMatch(adminClient, /NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY/)
  assert.match(migration, /revoke insert, update on table public\.messages, public\.twin_profiles from authenticated/i)
  assert.match(migration, /grant execute on function public\.persist_chat_turn_server\([\s\S]*?to service_role/i)
  assert.match(sqlTest, /authenticated direct assistant insert unexpectedly succeeded/)
  assert.match(sqlTest, /authenticated server-only writer RPC unexpectedly succeeded/)
})
