import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const testDirectory = path.dirname(fileURLToPath(import.meta.url))
const pagePath = path.resolve(testDirectory, '../app/page.tsx')

test('chat send is guarded synchronously against duplicate submit events', async () => {
  const source = await readFile(pagePath, 'utf8')

  assert.match(source, /const chatSendInFlight = useRef\(false\)/)
  assert.match(source, /chatSendInFlight\.current\s*\|\|\s*loading/)
  assert.match(source, /chatSendInFlight\.current = true/)
  assert.match(source, /finally\s*\{[\s\S]*?chatSendInFlight\.current = false[\s\S]*?setLoading\(false\)/)
})

test('send lock does not remove draft restoration or exact optimistic rollback', async () => {
  const source = await readFile(pagePath, 'utf8')

  assert.match(source, /setText\(userText\)/)
  assert.match(source, /current\.filter\(\(item\) => item !== optimisticUserMessage\)/)
})
