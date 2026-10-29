import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveChatCompletionsUrl } from '../lib/huggingface.ts'

test('default chat endpoint remains the Hugging Face router', () => {
  assert.equal(
    resolveChatCompletionsUrl(undefined),
    'https://router.huggingface.co/v1/chat/completions'
  )
  assert.equal(
    resolveChatCompletionsUrl(''),
    'https://router.huggingface.co/v1/chat/completions'
  )
})

test('trusted router and dedicated Hugging Face Inference Endpoint URLs are accepted', () => {
  assert.equal(
    resolveChatCompletionsUrl('https://router.huggingface.co/v1/chat/completions'),
    'https://router.huggingface.co/v1/chat/completions'
  )
  assert.equal(
    resolveChatCompletionsUrl(
      'https://qwen-adapter.us-east-1.aws.endpoints.huggingface.cloud/v1/chat/completions'
    ),
    'https://qwen-adapter.us-east-1.aws.endpoints.huggingface.cloud/v1/chat/completions'
  )
})

test('chat endpoint override rejects arbitrary hosts and unsafe URL components', () => {
  const invalidUrls = [
    'http://router.huggingface.co/v1/chat/completions',
    'https://attacker.example/v1/chat/completions',
    'https://router.huggingface.co.attacker.example/v1/chat/completions',
    'https://router.huggingface.co/v1/chat/completions?token=secret',
    'https://router.huggingface.co/v1/chat/completions#fragment',
    'https://user:password@router.huggingface.co/v1/chat/completions',
    'https://router.huggingface.co:8443/v1/chat/completions',
    'https://router.huggingface.co/chat/completions'
  ]

  for (const url of invalidUrls) {
    assert.equal(resolveChatCompletionsUrl(url), null, url)
  }
})
