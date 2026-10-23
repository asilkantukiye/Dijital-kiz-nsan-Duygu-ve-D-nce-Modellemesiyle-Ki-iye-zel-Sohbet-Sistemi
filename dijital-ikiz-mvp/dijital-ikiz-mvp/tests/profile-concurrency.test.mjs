import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const directory = path.dirname(fileURLToPath(import.meta.url))
const project = path.resolve(directory, '..')

test('profile persistence merges observations against the locked latest row', async () => {
  const migration = await readFile(
    path.join(project, 'supabase/migrations/20261023210000_aud_03_concurrent_profile_updates.sql'),
    'utf8'
  )
  const route = await readFile(path.join(project, 'app/api/chat/route.ts'), 'utf8')

  assert.match(migration, /ON CONFLICT \(user_id\) DO UPDATE[\s\S]*?merge_twin_profile_observation\([\s\S]*?twin_profiles\.profile,[\s\S]*?EXCLUDED\.profile/s)
  assert.match(migration, /RETURNING profile INTO v_profile_snapshot/i)
  assert.match(migration, /SELECT \*[\s\S]*?FOR UPDATE/i)
  assert.match(migration, /SET profile = public\.merge_twin_profile_observation/i)
  assert.match(migration, /jsonb_object_length\(p_profile_snapshot\) <> 13/i)
  assert.match(migration, /status = 'completed'[\s\S]*?response = v_response/s)
  assert.match(migration, /FROM PUBLIC, anon, authenticated/i)
  assert.match(migration, /TO service_role/i)

  assert.match(route, /const profileObservation = variant === 'personalized' \? analyzeMessage\(message, null\) : null/)
  assert.match(route, /p_profile_snapshot: profileObservation/)
  assert.doesNotMatch(route, /p_profile_snapshot: profileSnapshot/)
})

test('CI runs the concurrent PostgreSQL profile-update stress test after migrations', async () => {
  const workflow = await readFile(
    path.join(project, '..', '..', '..', '.github/workflows/ci.yml'),
    'utf8'
  )
  const migrationPosition = workflow.indexOf('--file supabase/migrations/20261023210000_aud_03_concurrent_profile_updates.sql')
  const testPosition = workflow.indexOf('name: Test concurrent profile updates against PostgreSQL')
  assert.notEqual(migrationPosition, -1)
  assert.ok(testPosition > migrationPosition)
  assert.match(workflow, /node tests\/profile-update-concurrency\.integration\.mjs/)
})
