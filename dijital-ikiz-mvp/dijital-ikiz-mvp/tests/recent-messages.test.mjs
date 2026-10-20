import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { chronologicalMessagesFromNewestFirst } from '../lib/recent-messages.ts'

const testDirectory = path.dirname(fileURLToPath(import.meta.url))
const pagePath = path.resolve(testDirectory, '..', 'app', 'page.tsx')

test('chat history fetch keeps the latest 100 messages and renders them chronologically', async () => {
  const page = await readFile(pagePath, 'utf8')

  assert.match(
    page,
    /\.order\('created_at', \{ ascending: false \}\)\s*\.limit\(100\)/
  )
  assert.match(page, /chronologicalMessagesFromNewestFirst\(storedMessages\)/)

  const result = chronologicalMessagesFromNewestFirst([
    { id: 'newest', created_at: '2026-10-20T12:00:00.000Z' },
    { id: 'middle', created_at: '2026-10-20T11:00:00.000Z' },
    { id: 'oldest-of-the-loaded-window', created_at: '2026-10-20T10:00:00.000Z' }
  ])

  assert.deepEqual(
    result.map((item) => item.id),
    ['oldest-of-the-loaded-window', 'middle', 'newest']
  )
})

test('missing chat history is presented as an empty list', () => {
  assert.deepEqual(chronologicalMessagesFromNewestFirst(null), [])
  assert.deepEqual(chronologicalMessagesFromNewestFirst(undefined), [])
})

test('chronological conversion does not mutate the Supabase query result', () => {
  const newestFirst = ['newest', 'older']
  const result = chronologicalMessagesFromNewestFirst(newestFirst)

  assert.deepEqual(result, ['older', 'newest'])
  assert.deepEqual(newestFirst, ['newest', 'older'])
})
