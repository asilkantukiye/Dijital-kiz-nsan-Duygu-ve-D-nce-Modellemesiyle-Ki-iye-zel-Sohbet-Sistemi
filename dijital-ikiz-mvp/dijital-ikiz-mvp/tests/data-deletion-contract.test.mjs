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


test('data deletion invalidates in-flight chat claims and rejects stale generations', async () => {
  const raceMigration = await readFile(
    path.join(projectDirectory, 'supabase', 'migrations', '20261027200805_delete_my_chat_inflight_claims.sql'),
    'utf8'
  )
  const raceIntegration = await readFile(
    path.join(projectDirectory, 'tests', 'sql', 'data_deletion_idempotency.integration.sql'),
    'utf8'
  )
  const chatRoute = await readFile(
    path.join(projectDirectory, 'app', 'api', 'chat', 'route.ts'),
    'utf8'
  )
  const memoryService = await readFile(path.join(projectDirectory, 'lib', 'memory.ts'), 'utf8')

  assert.match(raceMigration, /create table if not exists public\.chat_user_data_generations/i)
  assert.match(raceMigration, /alter table public\.memory_items[\s\S]*data_generation integer not null default 0/i)
  assert.match(raceMigration, /create policy "users insert current-generation memory items"[\s\S]*data_generation = public\.current_my_chat_data_generation\(\)/i)
  assert.match(raceMigration, /create policy "users update current-generation memory items"[\s\S]*using \([\s\S]*current_my_chat_data_generation\(\)[\s\S]*with check \([\s\S]*current_my_chat_data_generation\(\)/i)
  assert.match(raceMigration, /create policy "users delete own memory items"[\s\S]*for delete to authenticated[\s\S]*using \(\(select auth\.uid\(\)\) = user_id\)/i)
  assert.match(raceMigration, /select generation[\s\S]*for share/i)
  assert.match(raceMigration, /p_generation integer default null/i)
  assert.match(raceMigration, /errcode = 'P0409'/i)
  assert.match(raceMigration, /set generation = generation \+ 1/i)
  assert.match(raceMigration, /delete from public\.chat_request_deduplication[\s\S]*where user_id = v_user_id/i)
  assert.match(raceMigration, /create or replace function public\.delete_my_chat_request_claims_for_current_user\(\)[\s\S]*security definer[\s\S]*set search_path = pg_catalog, public/i)
  assert.match(raceMigration, /revoke all on function public\.delete_my_chat_request_claims_for_current_user\(\) from public, anon/i)
  assert.match(raceMigration, /grant execute on function public\.delete_my_chat_request_claims_for_current_user\(\) to authenticated/i)
  assert.match(raceMigration, /deleted_claims := public\.delete_my_chat_request_claims_for_current_user\(\)/i)
  assert.match(raceMigration, /'dedupe_rows_deleted', deleted_claims/i)
  assert.match(raceMigration, /create or replace function public\.persist_my_memory_at_generation\([\s\S]*security definer[\s\S]*set search_path = pg_catalog, public, extensions/i)
  assert.match(raceMigration, /for share[\s\S]*memory write invalidated by data deletion/i)
  assert.match(raceMigration, /revoke all on function public\.persist_my_memory_at_generation\([\s\S]*from public, anon, service_role/i)
  assert.match(raceMigration, /grant execute on function public\.persist_my_memory_at_generation\([\s\S]*to authenticated/i)

  assert.match(chatRoute, /get_chat_data_generation_server/)
  assert.match(chatRoute, /p_generation: chatDataGeneration/)
  assert.match(chatRoute, /code: 'CHAT_DATA_CHANGED'/)
  assert.match(chatRoute, /persistMemories\(user\.id, userMessageId, message, chatDataGeneration\)/)
  assert.match(memoryService, /persist_my_memory_at_generation/)
  assert.match(memoryService, /p_generation: chatDataGeneration/)

  assert.match(raceIntegration, /data deletion must remove both active claims/i)
  assert.match(raceIntegration, /deleted in-flight claim allowed a late worker to persist/i)
  assert.match(raceIntegration, /stale pre-deletion generation was allowed to claim new work/i)
  assert.match(raceIntegration, /deletion changed another user idempotency claim/i)
  assert.match(raceIntegration, /delayed memory upsert with the pre-deletion generation was accepted/i)
  assert.match(raceIntegration, /legacy direct memory insert bypassed the current-generation RLS guard/i)
  assert.match(raceIntegration, /current-generation memory write did not persist exactly once/i)
})
