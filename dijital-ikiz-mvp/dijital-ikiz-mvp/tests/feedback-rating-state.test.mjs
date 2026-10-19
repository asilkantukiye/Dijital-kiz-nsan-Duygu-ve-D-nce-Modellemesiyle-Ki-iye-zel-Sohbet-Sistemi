import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const testDirectory = path.dirname(fileURLToPath(import.meta.url))
const pagePath = path.resolve(testDirectory, '../app/page.tsx')

test('rating requests are synchronously locked per assistant message', async () => {
  const source = await readFile(pagePath, 'utf8')

  assert.match(source, /const feedbackInFlight = useRef<Set<string>>\(new Set\(\)\)/)
  assert.match(source, /if \(feedbackInFlight\.current\.has\(messageId\)\) return/)
  assert.match(source, /feedbackInFlight\.current\.add\(messageId\)/)
  assert.match(source, /feedbackInFlight\.current\.delete\(messageId\)/)
})

test('rating controls are disabled while their message rating is saving', async () => {
  const source = await readFile(pagePath, 'utf8')

  assert.match(source, /const \[savingFeedback, setSavingFeedback\] = useState<Record<string, boolean>>\(\{\}\)/)
  assert.match(source, /disabled=\{Boolean\(savingFeedback\[message\.id!?\]\)\}/)
  assert.match(source, /aria-pressed=\{feedback\[message\.id!\] === rating\}/)
  assert.match(source, /finally\s*\{[\s\S]*?feedbackInFlight\.current\.delete\(messageId\)[\s\S]*?delete next\[messageId\]/)
})
