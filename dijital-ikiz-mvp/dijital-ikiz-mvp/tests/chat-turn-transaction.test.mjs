import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const testDirectory = path.dirname(fileURLToPath(import.meta.url))
const appDirectory = path.resolve(testDirectory, '..')
const routePath = path.join(appDirectory, 'app', 'api', 'chat', 'route.ts')
const schemaPath = path.join(appDirectory, 'supabase', 'schema.sql')
const migrationPath = path.join(
  appDirectory,
  'supabase',
  'migrations',
  '20261020200000_atomic_chat_turn_persistence.sql'
)

test('chat route delegates paired message and profile persistence to the atomic RPC', async () => {
  const route = await readFile(routePath, 'utf8')

  assert.match(route, /supabase\.rpc\('persist_chat_turn'/)
  assert.doesNotMatch(route, /\.from\('twin_profiles'\)\s*\.upsert/)
  assert.doesNotMatch(route, /\.from\('messages'\)\s*\.insert/)
  assert.match(route, /p_profile_snapshot:\s*profileSnapshot/)
  assert.match(route, /persistMemories\(user\.id,\s*userMessageId,\s*message\)/)
  assert.match(route, /messageId:\s*assistantMessageId/)
})

test('atomic chat-turn SQL is included in both the consolidated schema and migration', async () => {
  const [schema, migration] = await Promise.all([
    readFile(schemaPath, 'utf8'),
    readFile(migrationPath, 'utf8')
  ])

  assert.ok(schema.includes(migration), 'fresh setup schema and incremental migration must stay aligned')
  assert.match(migration, /create or replace function public\.persist_chat_turn\(/i)
  assert.match(migration, /security invoker/i)
  assert.match(migration, /if v_user_id is null then/i)
  assert.match(migration, /jsonb_typeof\(p_profile_snapshot\) is distinct from 'object'/i)
  assert.match(migration, /insert into public\.twin_profiles/i)
  assert.equal((migration.match(/insert into public\.messages/gi) ?? []).length, 2)
  assert.match(migration, /revoke all on function public\.persist_chat_turn/i)
  assert.match(migration, /grant execute on function public\.persist_chat_turn.*to authenticated/i)
})
