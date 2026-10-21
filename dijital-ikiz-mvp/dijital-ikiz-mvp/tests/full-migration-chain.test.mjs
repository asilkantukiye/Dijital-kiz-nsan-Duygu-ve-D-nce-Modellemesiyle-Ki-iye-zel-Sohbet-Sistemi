import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const testDirectory = path.dirname(fileURLToPath(import.meta.url))
const projectDirectory = path.resolve(testDirectory, '..')
const repositoryDirectory = path.resolve(testDirectory, '../../..')

test('CI applies the complete Supabase migration chain in timestamp order', async () => {
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
    '20261020200000_atomic_chat_turn_persistence.sql'
  ]

  const positions = migrations.map((migration) => {
    const position = workflow.indexOf(`--file supabase/migrations/${migration}`)
    assert.notEqual(position, -1, `CI must apply ${migration}`)
    return position
  })

  assert.deepEqual(positions, [...positions].sort((a, b) => a - b))
  assert.ok(workflow.indexOf('--file tests/sql/migration_catalog.integration.sql') > positions.at(-1))
  assert.ok(workflow.indexOf('--file tests/sql/persist_chat_turn.integration.sql') > positions.at(-1))
  assert.ok(workflow.indexOf('--file tests/sql/security_rpc.integration.sql') > positions.at(-1))
})

test('migration integration fixture starts before the Stage 5 memory table exists', async () => {
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
  assert.match(memoryMigration, /create table if not exists public\.memory_items/i)
  assert.match(memoryMigration, /embedding extensions\.vector\(384\)/i)
  assert.match(memoryMigration, /create policy "users own memory items"/i)
})

test('vector retrieval and migration catalogue assertions are part of PostgreSQL integration tests', async () => {
  const [securitySql, catalogSql] = await Promise.all([
    readFile(path.join(projectDirectory, 'tests', 'sql', 'security_rpc.integration.sql'), 'utf8'),
    readFile(path.join(projectDirectory, 'tests', 'sql', 'migration_catalog.integration.sql'), 'utf8')
  ])

  assert.match(securitySql, /public\.match_memory_items\(query_embedding, 0\.72, 5\)/)
  assert.match(securitySql, /memory RPC did not enforce user-scoped retrieval/)
  assert.match(catalogSql, /memory_items\.embedding must be vector\(384\)/)
  assert.match(catalogSql, /row-level security is not enabled/)
  assert.match(catalogSql, /must remain SECURITY INVOKER/)
  assert.match(catalogSql, /anon unexpectedly has EXECUTE/)
  assert.match(catalogSql, /authenticated is missing EXECUTE/)
})
