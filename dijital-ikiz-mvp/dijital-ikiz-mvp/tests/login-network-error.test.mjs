import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const testDirectory = path.dirname(fileURLToPath(import.meta.url))
const pagePath = path.resolve(testDirectory, '../app/login/page.tsx')

test('legacy login route redirects to anonymous app and renders no credential form', async () => {
  const source = await readFile(pagePath, 'utf8')
  assert.match(source, /redirect\('\/'\)/)
  assert.doesNotMatch(source, /signInWithPassword|signUp\(|type=["']password["']/)
})
