import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { readJsonBodyLimited } from '../lib/request-body.ts'

const testDirectory = path.dirname(fileURLToPath(import.meta.url))
const projectDirectory = path.resolve(testDirectory, '..')

function postRequest(body, headers = {}) {
  return new Request('https://example.test/api/test', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body
  })
}

test('parses a valid JSON body within the byte limit', async () => {
  const result = await readJsonBodyLimited(postRequest('{"message":"hello"}'), 128)
  assert.deepEqual(result, { ok: true, value: { message: 'hello' } })
})

test('rejects malformed and empty JSON bodies', async () => {
  const malformed = await readJsonBodyLimited(postRequest('{"message":'), 128)
  assert.equal(malformed.ok, false)
  if (!malformed.ok) assert.equal(malformed.status, 400)

  const empty = await readJsonBodyLimited(postRequest(''), 128)
  assert.equal(empty.ok, false)
  if (!empty.ok) assert.equal(empty.status, 400)
})

test('rejects a declared oversized body before reading the stream', async () => {
  let readAttempted = false
  const body = new ReadableStream({
    pull(controller) {
      readAttempted = true
      controller.enqueue(new TextEncoder().encode('{"message":"small"}'))
      controller.close()
    }
  })
  const request = new Request('https://example.test/api/test', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': '1000' },
    body,
    duplex: 'half'
  })

  const result = await readJsonBodyLimited(request, 128)
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.status, 413)
  assert.equal(readAttempted, false)
})

test('rejects actual bytes beyond the limit even if content-length is absent', async () => {
  const result = await readJsonBodyLimited(postRequest('x'.repeat(129)), 128)
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.status, 413)
    assert.match(result.error, /boyut/)
  }
})

test('rejects malformed content-length and invalid UTF-8', async () => {
  const badLength = await readJsonBodyLimited(
    postRequest('{"ok":true}', { 'content-length': 'not-a-number' }),
    128
  )
  assert.equal(badLength.ok, false)
  if (!badLength.ok) assert.equal(badLength.status, 400)

  const badUtf8 = new Request('https://example.test/api/test', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([0xff, 0xfe, 0xfd]))
        controller.close()
      }
    }),
    duplex: 'half'
  })
  const invalidUtf8 = await readJsonBodyLimited(badUtf8, 128)
  assert.equal(invalidUtf8.ok, false)
  if (!invalidUtf8.ok) assert.equal(invalidUtf8.status, 400)
})

test('chat and feedback routes use byte-bounded parsing before field validation', async () => {
  const chat = await readFile(path.join(projectDirectory, 'app/api/chat/route.ts'), 'utf8')
  const feedback = await readFile(path.join(projectDirectory, 'app/api/feedback/route.ts'), 'utf8')

  assert.match(chat, /readJsonBodyLimited\(req,\s*16\s*\*\s*1024\)/)
  assert.match(feedback, /readJsonBodyLimited\(req,\s*8\s*\*\s*1024\)/)
  assert.doesNotMatch(chat, /req\.json\(\)/)
  assert.doesNotMatch(feedback, /req\.json\(\)/)
})

