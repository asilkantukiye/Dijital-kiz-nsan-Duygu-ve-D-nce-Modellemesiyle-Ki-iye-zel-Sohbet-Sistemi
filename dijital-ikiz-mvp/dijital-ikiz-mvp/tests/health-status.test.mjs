import assert from 'node:assert/strict'
import test from 'node:test'

import { buildHealthStatus } from '../lib/health-status.ts'

test('health is live but not ready when backend configuration is missing', () => {
  const status = buildHealthStatus({})

  assert.equal(status.ok, true)
  assert.equal(status.ready, false)
  assert.deepEqual(status.configured, {
    supabase: false,
    huggingface: false
  })
})

test('health is ready only when Supabase and Hugging Face configuration are present', () => {
  const status = buildHealthStatus({
    supabaseUrl: 'https://project.example.supabase.co',
    supabasePublishableKey: 'publishable-placeholder',
    huggingfaceToken: 'secret-placeholder'
  })

  assert.equal(status.ok, true)
  assert.equal(status.ready, true)
  assert.deepEqual(status.configured, {
    supabase: true,
    huggingface: true
  })
})

test('health is not ready if any required provider configuration is absent', () => {
  const missingSupabaseKey = buildHealthStatus({
    supabaseUrl: 'https://project.example.supabase.co',
    huggingfaceToken: 'secret-placeholder'
  })
  const missingHuggingFace = buildHealthStatus({
    supabaseUrl: 'https://project.example.supabase.co',
    supabasePublishableKey: 'publishable-placeholder'
  })

  assert.equal(missingSupabaseKey.ready, false)
  assert.equal(missingHuggingFace.ready, false)
})

test('whitespace-only environment values count as missing', () => {
  const status = buildHealthStatus({
    supabaseUrl: '  ',
    supabasePublishableKey: '\t',
    huggingfaceToken: '\n'
  })

  assert.equal(status.ready, false)
  assert.deepEqual(status.configured, {
    supabase: false,
    huggingface: false
  })
})

test('health response reports configuration presence, never credential values', () => {
  const status = buildHealthStatus({
    supabaseUrl: 'https://project.example.supabase.co',
    supabasePublishableKey: 'publishable-secret-must-not-appear',
    huggingfaceToken: 'hf-secret-must-not-appear'
  })
  const serialized = JSON.stringify(status)

  assert.doesNotMatch(serialized, /publishable-secret-must-not-appear/)
  assert.doesNotMatch(serialized, /hf-secret-must-not-appear/)
})
