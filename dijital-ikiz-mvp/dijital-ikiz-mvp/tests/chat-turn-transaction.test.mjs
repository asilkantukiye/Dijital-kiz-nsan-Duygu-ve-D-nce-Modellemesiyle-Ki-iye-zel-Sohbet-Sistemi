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

test('chat route uses verified auth identity and server-only atomic persistence', async () => {
  const route = await readFile(routePath, 'utf8')

  assert.match(route, /supabase\.auth\.getUser\(\)/)
  assert.match(route, /adminSupabase\.rpc\('persist_chat_turn_idempotent_server'/)
  assert.match(route, /p_user_id:\s*user\.id/)
  assert.doesNotMatch(route, /bodyResult\.value\.(?:user_id|userId|session_id|sessionId)/)
  assert.doesNotMatch(route, /\.from\('twin_profiles'\)\s*\.upsert/)
  assert.doesNotMatch(route, /\.from\('messages'\)\s*\.insert/)
  assert.match(route, /if \(!user\)[\s\S]*?status: 401/)
  assert.match(route, /persistMemories\(user\.id,\s*userMessageId,\s*message,\s*chatDataGeneration\)/)
  assert.match(route, /get_chat_data_generation_server/)
  assert.match(route, /p_generation:\s*chatDataGeneration/)
  assert.match(route, /return NextResponse\.json\(cachedResponse/)
  assert.match(route, /p_response_payload:\s*\{[\s\S]*?reply,[\s\S]*?variant/)
})

test('atomic chat-turn SQL is included in both the consolidated schema and migration', async () => {
  const [schema, migration] = await Promise.all([
    readFile(schemaPath, 'utf8'),
    readFile(migrationPath, 'utf8')
  ])

  assert.ok(schema.includes(migration), 'fresh setup schema and incremental migration must stay aligned')
  assert.match(migration, /create or replace function public\.persist_chat_turn\(/i)
  assert.match(migration, /security invoker/i)
  assert.match(migration, /v_user_id uuid := auth\.uid\(\)/i)
  assert.match(migration, /if v_user_id is null then/i)
  assert.match(migration, /p_variant not in \('personalized', 'baseline'\)/i)
  assert.match(migration, /char_length\(p_user_content\) not between 1 and 4000/i)
  assert.match(migration, /char_length\(p_assistant_content\) not between 1 and 4000/i)
  assert.match(migration, /p_assistant_created_at <= p_user_created_at/i)
  assert.match(migration, /jsonb_typeof\(p_profile_snapshot\) is distinct from 'object'/i)
  assert.match(migration, /insert into public\.twin_profiles/i)
  assert.equal((migration.match(/insert into public\.messages/gi) ?? []).length, 2)
  assert.match(migration, /'user', p_variant, p_user_content/i)
  assert.match(migration, /'assistant', p_variant, p_assistant_content/i)
  assert.match(migration, /revoke all on function public\.persist_chat_turn/i)
  assert.match(migration, /from public/i)
  assert.match(migration, /from anon/i)
  assert.match(migration, /grant execute on function public\.persist_chat_turn.*to authenticated/i)
})


test('AUD-01 migration closes user JWT write paths and grants only the service writer', async () => {
  const boundaryPath = path.join(
    appDirectory,
    'supabase',
    'migrations',
    '20261023196000_aud_01_chat_write_boundary.sql'
  )
  const boundary = await readFile(boundaryPath, 'utf8')

  assert.match(boundary, /revoke insert, update on table public\.messages, public\.twin_profiles from authenticated/i)
  assert.match(boundary, /revoke all on function public\.persist_chat_turn\([\s\S]*?from public, anon, authenticated/i)
  assert.match(boundary, /create or replace function public\.persist_chat_turn_server\(/i)
  assert.match(boundary, /current_user <> 'service_role'/i)
  assert.match(boundary, /grant execute on function public\.persist_chat_turn_server\([\s\S]*?to service_role/i)
  assert.doesNotMatch(boundary, /grant execute on function public\.persist_chat_turn_server[\s\S]*?to authenticated/i)
})
