import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const here = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.resolve(here, '..')

test('180-day memory cleanup is scheduled outside chat activity and bounded per run', async () => {
  const migration = await readFile(
    path.join(appRoot, 'supabase', 'migrations', '20261023193000_stage5_1_memory_retention_cron.sql'),
    'utf8'
  )

  assert.match(migration, /create extension if not exists pg_cron/i)
  assert.match(migration, /cron\.schedule\(/i)
  assert.match(migration, /'\*\/15 \* \* \* \*'/)
  assert.match(migration, /interval '180 days'/i)
  assert.match(migration, /limit 1000/i)
  assert.match(migration, /delete from public\.memory_items/i)
  assert.doesNotMatch(migration, /delete from public\.messages/i)
})

test('retention migration declares indexes for stale memory scans', async () => {
  const migration = await readFile(
    path.join(appRoot, 'supabase', 'migrations', '20261023193000_stage5_1_memory_retention_cron.sql'),
    'utf8'
  )

  assert.match(migration, /memory_items_retention_never_used_idx/)
  assert.match(migration, /memory_items_retention_used_idx/)
  assert.match(migration, /last_used_at is null/i)
  assert.match(migration, /last_used_at < now\(\) - interval '180 days'/i)
})

test('retention migration schedules a bounded nightly cleanup for legacy over-cap users', async () => {
  const migration = await readFile(
    path.join(appRoot, 'supabase', 'migrations', '20261023193000_stage5_1_memory_retention_cron.sql'),
    'utf8'
  )

  assert.match(migration, /stage5-memory-cap-cleanup/)
  assert.match(migration, /'15 3 \* \* \*'/)
  assert.match(migration, /row_number\(\) over\s*\(\s*partition by user_id/i)
  assert.match(migration, /row_number > 50/i)
  assert.match(migration, /limit 1000/i)
})
