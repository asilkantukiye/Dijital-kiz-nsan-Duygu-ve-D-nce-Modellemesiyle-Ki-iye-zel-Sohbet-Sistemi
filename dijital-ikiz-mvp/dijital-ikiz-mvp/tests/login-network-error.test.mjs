import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const testDirectory = path.dirname(fileURLToPath(import.meta.url))
const pagePath = path.resolve(testDirectory, '../app/login/page.tsx')

test('login and signup show a user-friendly message when the auth request throws', async () => {
  const source = await readFile(pagePath, 'utf8')

  assert.match(source, /catch\s*\{[\s\S]*?setMsg\([\s\S]*?Sunucuya ulaşılamadı/)
  assert.match(source, /finally\s*\{\s*setLoading\(false\)/)
  assert.doesNotMatch(source, /setMsg\(error\.message\)/)
})

test('login mode switch cannot be changed while an auth request is in flight', async () => {
  const source = await readFile(pagePath, 'utf8')

  assert.match(
    source,
    /disabled=\{loading\}\s+onClick=\{\(\) => \{\s*setMode/
  )
})
