import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const testDirectory = path.dirname(fileURLToPath(import.meta.url))
const projectDirectory = path.resolve(testDirectory, '..')
const repositoryDirectory = path.resolve(testDirectory, '../../..')

test('CI applies all eight Supabase migrations in timestamp order', async () => {
  const workflow = await readFile(
    path.join(repositoryDirectory, '.github', 'workflows', 'ci.yml'),
    'utf8'
  )

  assert.match(workflow, /image: pgvector\/pgvector:pg17/)
  const migrations = [
    '20261008191854_rls_and_ab_performance_hardening.sql',
    '20261008202104_stage5_memory_engine.sql',
    '20261008202255_stage5_memory_fk_index.sql',
    '20261018190000_atomic_user_data_deletion.sql',
    '20261019175000_feedback_message_ownership_rls.sql',
    '20261020200000_atomic_chat_turn_persistence.sql',
    '20261021210000_stage5_memory_extensions_usage.sql',
    '20261021211000_stage5_atomic_memory_preference_update.sql'
  ]

  const positions = migrations.map((migration) => {
    const position = workflow.indexOf('--file supabase/migrations/' + migration)
    assert.notEqual(position, -1, 'CI must apply ' + migration)
    return position
  })

  assert.deepEqual(positions, [...positions].sort((a, b) => a - b))
  const finalMigration = positions[positions.length - 1]
  const postMigrationChecks = [
    'tests/sql/migration_catalog.integration.sql',
    'tests/sql/persist_chat_turn.integration.sql',
    'tests/sql/memory_rls.integration.sql',
    'tests/sql/memory_preference_update.integration.sql',
    'tests/sql/security_rpc.integration.sql'
  ]
  for (const check of postMigrationChecks) {
    const position = workflow.indexOf('--file ' + check)
    assert.ok(position > finalMigration, check + ' must run after every migration')
  }
})

test('integration fixture intentionally predates the memory table and production RPCs', async () => {
  const setup = await readFile(
    path.join(projectDirectory, 'tests', 'sql', 'persist_chat_turn.setup.sql'),
    'utf8'
  )
  const memoryMigration = await readFile(
    path.join(projectDirectory, 'supabase', 'migrations', '20261008202104_stage5_memory_engine.sql'),
    'utf8'
  )

  assert.match(setup, /CREATE TABLE public\.twin_profiles/)
  assert.match(setup, /CREATE TABLE public\.messages/)
  assert.match(setup, /CREATE POLICY "users own twin profile"/)
  assert.match(setup, /CREATE POLICY "users own messages"/)
  assert.doesNotMatch(setup, /CREATE TABLE public\.memory_items/)
  assert.doesNotMatch(setup, /CREATE OR REPLACE FUNCTION public\.(?:match_memory_items|persist_chat_turn|replace_my_memory_preference)/)
  assert.match(memoryMigration, /create table if not exists public\.memory_items/i)
  assert.match(memoryMigration, /embedding extensions\.vector\(384\)/i)
  assert.match(memoryMigration, /create policy "users own memory items"/i)
})

test('migration catalog checks vector placement, the complete RPC set, RLS and permissions', async () => {
  const [memoryRlsSql, catalogSql] = await Promise.all([
    readFile(path.join(projectDirectory, 'tests', 'sql', 'memory_rls.integration.sql'), 'utf8'),
    readFile(path.join(projectDirectory, 'tests', 'sql', 'migration_catalog.integration.sql'), 'utf8')
  ])

  assert.match(memoryRlsSql, /public\.match_memory_items\(/)
  assert.match(memoryRlsSql, /memory matching RPC leaked or hid rows/)
  assert.match(catalogSql, /memory_items\.embedding must be vector\(384\)/)
  assert.match(catalogSql, /row-level security is not enabled/)
  assert.match(catalogSql, /must remain SECURITY INVOKER/)
  assert.match(catalogSql, /anon unexpectedly has EXECUTE/)
  assert.match(catalogSql, /authenticated is missing EXECUTE/)
  assert.match(catalogSql, /replace_my_memory_preference/)
  assert.match(catalogSql, /authenticated is missing USAGE on extensions schema/)
  assert.match(catalogSql, /memory source-message foreign-key index is missing/)
})
