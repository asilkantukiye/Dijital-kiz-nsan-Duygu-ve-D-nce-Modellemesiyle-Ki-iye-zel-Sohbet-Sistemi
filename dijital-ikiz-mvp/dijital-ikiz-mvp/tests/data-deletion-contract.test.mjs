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
  '20261018190000_atomic_user_data_deletion.sql'
)
const routePath = path.join(projectDirectory, 'app', 'api', 'data', 'route.ts')

test('API delegates chat-data deletion to one database RPC', async () => {
  const route = await readFile(routePath, 'utf8')

  assert.match(route, /supabase\.rpc\(['"]delete_my_chat_data['"]\)/)
  assert.doesNotMatch(route, /from\(['"]messages['"]\)\.delete\(/)
  assert.doesNotMatch(route, /from\(['"]twin_profiles['"]\)\.delete\(/)
  assert.doesNotMatch(route, /from\(['"]memory_items['"]\)\.delete\(/)
})

test('database deletion is invoker-scoped and refuses unauthenticated calls', async () => {
  const sql = await readFile(migrationPath, 'utf8')

  assert.match(sql, /create or replace function public\.delete_my_chat_data\(\)/i)
  assert.match(sql, /security invoker/i)
  assert.doesNotMatch(sql, /security definer/i)
  assert.match(sql, /if auth\.uid\(\) is null then/i)
  assert.match(sql, /where user_id = \(select auth\.uid\(\)\)/i)
  assert.match(sql, /revoke all on function public\.delete_my_chat_data\(\) from public/i)
  assert.match(sql, /revoke all on function public\.delete_my_chat_data\(\) from anon/i)
  assert.match(sql, /grant execute on function public\.delete_my_chat_data\(\) to authenticated/i)
})

test('one database function covers memories, twin profiles and messages', async () => {
  const sql = await readFile(migrationPath, 'utf8')

  for (const table of [
    'public.memory_items',
    'public.twin_profiles',
    'public.messages'
  ]) {
    assert.match(sql, new RegExp('delete from ' + table.replace('.', '\\.') + '\\s+where user_id = \\(select auth\\.uid\\(\\)\\)', 'i'))
  }

  assert.match(sql, /message_feedback rows are deleted by the messages FK's ON DELETE CASCADE/i)
})
