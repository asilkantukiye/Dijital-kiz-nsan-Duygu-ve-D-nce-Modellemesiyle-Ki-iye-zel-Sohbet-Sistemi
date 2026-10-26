import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const testDirectory = path.dirname(fileURLToPath(import.meta.url))
const projectDirectory = path.resolve(testDirectory, '..')
const migrationPath = path.join(
  projectDirectory,
  'supabase',
  'migrations',
  '20261026170000_aud_07_storage_and_recovery_hardening.sql'
)
const routePath = path.join(projectDirectory, 'app', 'api', 'data', 'route.ts')

test('API derives the deletion target from the verified session and invokes one server-only RPC', async () => {
  const route = await readFile(routePath, 'utf8')
  const authPosition = route.indexOf('supabase.auth.getUser()')
  const userGuardPosition = route.indexOf('if (!user)')
  const deletePosition = route.indexOf("adminSupabase.rpc('delete_my_chat_data_server'")

  assert.ok(authPosition >= 0 && userGuardPosition > authPosition && deletePosition > userGuardPosition)
  assert.match(route, /import \{ createAdminClient \} from '@\/lib\/supabase-admin'/)
  assert.match(route, /p_user_id:\s*user\.id/)
  assert.doesNotMatch(route, /body\.(?:user_id|userId|session_id|sessionId)/)
  assert.doesNotMatch(route, /from\(['"]messages['"]\)\.delete\(/)
  assert.doesNotMatch(route, /from\(['"]twin_profiles['"]\)\.delete\(/)
  assert.doesNotMatch(route, /from\(['"]memory_items['"]\)\.delete\(/)
})

test('server deletion is SECURITY INVOKER, server-role-only, and serialized with chat state writes', async () => {
  const sql = await readFile(migrationPath, 'utf8')

  assert.match(sql, /create or replace function public\.delete_my_chat_data_server\(p_user_id uuid\)/i)
  assert.match(sql, /security invoker/i)
  assert.doesNotMatch(sql, /security definer/i)
  assert.match(sql, /if current_user <> 'service_role' then/i)
  assert.match(sql, /pg_catalog\.pg_advisory_xact_lock\(pg_catalog\.hashtextextended\(p_user_id::text, 0\)\)/i)
  assert.match(sql, /revoke all on function public\.delete_my_chat_data_server\(uuid\) from public, anon, authenticated/i)
  assert.match(sql, /grant execute on function public\.delete_my_chat_data_server\(uuid\) to service_role/i)
  assert.match(sql, /revoke all on function public\.delete_my_chat_data\(\) from public, anon, authenticated/i)
})

test('deletion invalidates idempotency claims before removing memories, profiles, and messages', async () => {
  const sql = await readFile(migrationPath, 'utf8')
  const claims = sql.indexOf('DELETE FROM public.chat_request_deduplication WHERE user_id = p_user_id')
  const memories = sql.indexOf('DELETE FROM public.memory_items WHERE user_id = p_user_id')
  const profiles = sql.indexOf('DELETE FROM public.twin_profiles WHERE user_id = p_user_id')
  const messages = sql.indexOf('DELETE FROM public.messages WHERE user_id = p_user_id')

  assert.ok(claims >= 0 && memories > claims && profiles > memories && messages > profiles)
  assert.match(sql, /'chat_claims_deleted', deleted_claims/)
  assert.match(sql, /grant select, delete on table public\.memory_items to service_role/i)
  assert.match(sql, /grant delete on table public\.twin_profiles, public\.messages to service_role/i)
})
