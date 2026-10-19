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
  '20261019175000_feedback_message_ownership_rls.sql'
)
const schemaPath = path.join(projectDirectory, 'supabase', 'schema.sql')

function extractFeedbackPolicy(sql) {
  const match = sql.match(/create policy "users own feedback"[\s\S]*?;/i)
  assert.ok(match, 'RLS policy "users own feedback" must exist')
  return match[0]
}

function assertFeedbackPolicyEnforcesMessageOwnership(sql) {
  const policy = extractFeedbackPolicy(sql)

  assert.match(policy, /for all/i)
  assert.match(policy, /using\s*\(\s*\(select auth\.uid\(\)\)\s*=\s*user_id\s*\)/i)
  assert.match(policy, /with check\s*\([\s\S]*?exists\s*\(/i)
  assert.match(policy, /referenced_message\.id\s*=\s*message_feedback\.message_id/i)
  assert.match(policy, /referenced_message\.user_id\s*=\s*\(select auth\.uid\(\)\)/i)
  assert.match(policy, /referenced_message\.role\s*=\s*'assistant'/i)
  assert.match(policy, /referenced_message\.variant\s*=\s*message_feedback\.variant/i)
}

test('feedback RLS binds new and updated feedback to the caller own assistant message and variant', async () => {
  const migration = await readFile(migrationPath, 'utf8')
  assertFeedbackPolicyEnforcesMessageOwnership(migration)
})

test('consolidated schema matches the feedback ownership RLS migration', async () => {
  const schema = await readFile(schemaPath, 'utf8')
  assertFeedbackPolicyEnforcesMessageOwnership(schema)
})

test('migration removes legacy feedback rows with cross-user or mismatched message references', async () => {
  const migration = await readFile(migrationPath, 'utf8')

  assert.match(migration, /delete from public\.message_feedback as feedback/i)
  assert.match(migration, /where not exists\s*\([\s\S]*?referenced_message\.user_id\s*=\s*feedback\.user_id/i)
  assert.match(migration, /referenced_message\.role\s*=\s*'assistant'/i)
  assert.match(migration, /referenced_message\.variant\s*=\s*feedback\.variant/i)
})
