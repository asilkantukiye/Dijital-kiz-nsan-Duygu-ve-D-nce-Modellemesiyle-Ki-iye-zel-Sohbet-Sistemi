import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const here = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.resolve(here, '..')

test('preference memory writes always go through the transactional locked RPC', async () => {
  const source = await readFile(path.join(appRoot, 'lib', 'memory.ts'), 'utf8')
  assert.match(source, /preferenceConflictKey\(item\.memory\.content\)/)
  assert.match(source, /supabase\.rpc\('upsert_my_memory_preference'/)
  assert.match(source, /item\.memory\.memory_type === 'preference' && item\.memory\.replaceExisting/)
})

test('database migration serializes and authorizes memory preference upserts', async () => {
  const migration = await readFile(
    path.join(appRoot, 'supabase', 'migrations', '20261023194000_stage5_1_atomic_preference_upsert.sql'),
    'utf8'
  )
  assert.match(migration, /pg_advisory_xact_lock/)
  assert.match(migration, /where user_id = v_user_id/)
  assert.match(migration, /preference_key = p_preference_key/)
  assert.match(migration, /security invoker/i)
  assert.match(migration, /revoke all .* from public/i)
  assert.match(migration, /revoke all .* from anon/i)
  assert.match(migration, /grant execute .* to authenticated/i)
  assert.match(migration, /Preference source message not found/)
})
