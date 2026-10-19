import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const testDirectory = path.dirname(fileURLToPath(import.meta.url))
const projectDirectory = path.resolve(testDirectory, '..')
const schemaPath = path.join(projectDirectory, 'supabase', 'schema.sql')
const migrationPath = path.join(
  projectDirectory,
  'supabase',
  'migrations',
  '20261019183000_feedback_relationship_rls.sql'
)

function policyBlock(sql) {
  const start = sql.indexOf('create policy "users own feedback"')
  assert.notEqual(start, -1, 'users own feedback policy must exist')
  const end = sql.indexOf(';', start)
  assert.notEqual(end, -1, 'feedback policy must terminate')
  return sql.slice(start, end + 1)
}

function assertRelationshipGuard(policy) {
  assert.match(policy, /using\s*\([\s\S]*?exists\s*\(/i)
  assert.match(policy, /with check\s*\([\s\S]*?exists\s*\(/i)
  assert.match(policy, /referenced_message\.id\s*=\s*message_feedback\.message_id/i)
  assert.match(policy, /referenced_message\.user_id\s*=\s*\(select auth\.uid\(\)\)/i)
  assert.match(policy, /referenced_message\.role\s*=\s*'assistant'/i)
  assert.match(policy, /referenced_message\.variant\s*=\s*message_feedback\.variant/i)
}

test('feedback RLS policy enforces the relationship on both reads/updates and writes', async () => {
  const schema = await readFile(schemaPath, 'utf8')
  const migration = await readFile(migrationPath, 'utf8')

  assertRelationshipGuard(policyBlock(schema))
  assertRelationshipGuard(policyBlock(migration))
})

test('feedback migration removes legacy rows that violate the policy before installing it', async () => {
  const migration = await readFile(migrationPath, 'utf8')

  assert.match(migration, /delete from public\.message_feedback as feedback/i)
  assert.match(migration, /referenced_message\.user_id\s*=\s*feedback\.user_id/i)
  assert.match(migration, /referenced_message\.role\s*=\s*'assistant'/i)
  assert.match(migration, /referenced_message\.variant\s*=\s*feedback\.variant/i)
  assert.doesNotMatch(migration, /security definer/i)
})
