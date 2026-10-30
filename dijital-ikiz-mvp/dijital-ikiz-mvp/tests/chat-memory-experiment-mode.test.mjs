import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const routeSource = await readFile(new URL('../app/api/chat/route.ts', import.meta.url), 'utf8')

test('CHAT_MEMORY_ENABLED=false disables memory retrieval for matched A/B conditions', () => {
  assert.match(routeSource, /const chatMemoryEnabled = process\.env\.CHAT_MEMORY_ENABLED !== 'false'/)
  assert.match(routeSource, /variant === 'personalized' && chatMemoryEnabled/)
})

test('CHAT_MEMORY_ENABLED=false also disables memory writes during the experiment', () => {
  assert.match(
    routeSource,
    /persistenceDisposition === 'completed' && variant === 'personalized' && chatMemoryEnabled/
  )
})
