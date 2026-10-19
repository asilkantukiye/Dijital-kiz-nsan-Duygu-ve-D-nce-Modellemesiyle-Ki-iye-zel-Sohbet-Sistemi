import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const testDirectory = path.dirname(fileURLToPath(import.meta.url))
const pagePath = path.resolve(testDirectory, '../app/page.tsx')

test('failed chat send restores the draft for retry', async () => {
  const source = await readFile(pagePath, 'utf8')

  assert.match(source, /catch \(error: unknown\)\s*\{[\s\S]*?setText\(userText\)/)
  assert.match(source, /Bağlantı kurulamadı\. Mesajını kaybettirmedim/)
})

test('failed chat send removes only the current optimistic message', async () => {
  const source = await readFile(pagePath, 'utf8')

  assert.match(source, /setMessages\(\(current\) => current\.filter\(\(item\) => item !== optimisticUserMessage\)\)/)
  assert.doesNotMatch(source, /setMessages\(\(current\) => current\.slice\(0, -1\)\)/)
})
