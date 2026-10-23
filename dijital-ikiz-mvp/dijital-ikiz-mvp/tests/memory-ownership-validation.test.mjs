import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const directory = path.dirname(fileURLToPath(import.meta.url))
const project = path.resolve(directory, '..')

test('memory source ownership is enforced by a composite database foreign key', async () => {
  const migration = await readFile(
    path.join(project, 'supabase/migrations/20261023220000_aud_04_memory_ownership_validation.sql'),
    'utf8'
  )
  const schema = await readFile(path.join(project, 'supabase/schema.sql'), 'utf8')
  const memory = await readFile(path.join(project, 'lib/memory.ts'), 'utf8')
  const sqlTest = await readFile(path.join(project, 'tests/sql/memory_source_ownership.integration.sql'), 'utf8')

  for (const source of [migration, schema]) {
    assert.match(source, /CREATE UNIQUE INDEX IF NOT EXISTS messages_id_user_id_uidx[\s\S]*?ON public\.messages \(id, user_id\)/i)
    assert.match(source, /FOREIGN KEY \(source_message_id, user_id\)[\s\S]*?REFERENCES public\.messages \(id, user_id\)[\s\S]*?ON DELETE SET NULL \(source_message_id\)/i)
  }
  assert.match(migration, /DELETE FROM public\.memory_items AS memory[\s\S]*?source\.user_id IS DISTINCT FROM memory\.user_id/i)
  assert.match(memory, /supabase\.auth\.getUser\(\)/)
  assert.match(memory, /user\.id !== userId/)
  assert.match(memory, /\.eq\('id', sourceMessageId\)[\s\S]*?\.eq\('user_id', authenticatedUserId\)/)
  assert.match(memory, /sourceMessage\.role !== 'user'/)
  assert.match(sqlTest, /EXCEPTION WHEN foreign_key_violation/)
  assert.match(sqlTest, /cross-tenant source-message insert was accepted/)
  assert.match(sqlTest, /cross-tenant ownership update was accepted/)
  assert.match(sqlTest, /confdelsetcols/)
})
