import assert from 'node:assert/strict'
import test from 'node:test'

import { qwenChat } from '../lib/huggingface.ts'

const messages = [{ role: 'user', content: 'test message' }]

test('Hugging Face chat timeout remains active while reading the response body', async () => {
  const previousToken = process.env.HF_TOKEN
  const previousFetch = globalThis.fetch
  let fetchCalls = 0

  process.env.HF_TOKEN = 'test-only-token'
  globalThis.fetch = async (_input, init = {}) => {
    fetchCalls += 1
    const signal = init.signal

    // Simulate headers arriving quickly while the response body never finishes.
    return new Response(new ReadableStream({
      start(controller) {
        signal?.addEventListener('abort', () => {
          controller.error(new DOMException('Request aborted', 'AbortError'))
        }, { once: true })
      }
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  try {
    await assert.rejects(
      qwenChat(messages, 10),
      /zaman aşımına uğradı/
    )
    assert.equal(fetchCalls, 2, 'a timed-out inference attempt should be retried once')
  } finally {
    globalThis.fetch = previousFetch
    if (previousToken === undefined) {
      delete process.env.HF_TOKEN
    } else {
      process.env.HF_TOKEN = previousToken
    }
  }
})

test('Hugging Face chat still returns a valid successful response', async () => {
  const previousToken = process.env.HF_TOKEN
  const previousFetch = globalThis.fetch
  let fetchCalls = 0

  process.env.HF_TOKEN = 'test-only-token'
  globalThis.fetch = async () => {
    fetchCalls += 1
    return new Response(
      JSON.stringify({ choices: [{ message: { content: 'Merhaba!' } }] }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    )
  }

  try {
    assert.equal(await qwenChat(messages, 1000), 'Merhaba!')
    assert.equal(fetchCalls, 1)
  } finally {
    globalThis.fetch = previousFetch
    if (previousToken === undefined) {
      delete process.env.HF_TOKEN
    } else {
      process.env.HF_TOKEN = previousToken
    }
  }
})
