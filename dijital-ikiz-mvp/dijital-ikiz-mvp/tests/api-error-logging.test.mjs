import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const testDirectory = path.dirname(fileURLToPath(import.meta.url))
const appDirectory = path.resolve(testDirectory, '..', 'app', 'api')

const routes = [
  {
    name: 'chat',
    file: path.join(appDirectory, 'chat', 'route.ts'),
    safeLog: "console.error('Chat API request failed; diagnostic details omitted.')"
  },
  {
    name: 'feedback',
    file: path.join(appDirectory, 'feedback', 'route.ts'),
    safeLog: "console.error('Feedback request failed; diagnostic details omitted.')"
  },
  {
    name: 'data deletion',
    file: path.join(appDirectory, 'data', 'route.ts'),
    safeLog: "console.error('Data deletion request failed; diagnostic details omitted.')"
  }
]

for (const route of routes) {
  test(`${route.name} API does not send raw exception objects to logs`, async () => {
    const source = await readFile(route.file, 'utf8')

    assert.ok(source.includes(route.safeLog), 'expected a generic operational failure log')
    assert.doesNotMatch(
      source,
      /console\.(?:error|warn|log)\([^\n]*,\s*error\s*\)/,
      'raw errors may contain provider, database, or user-derived details'
    )
  })
}
