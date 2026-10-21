import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

import {
  findMissingProductionEnvVariables,
  REQUIRED_PRODUCTION_ENVIRONMENT_VARIABLES
} from './helpers/verify-vercel-env.mjs'

test('production readiness requires Supabase URL, publishable key, and HF token names', () => {
  const missing = findMissingProductionEnvVariables([
    { key: 'NEXT_PUBLIC_SUPABASE_URL', target: ['production', 'preview'] },
    { key: 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', target: ['production', 'preview'] },
    { key: 'HF_MODEL', target: ['production', 'preview'] }
  ])

  assert.deepEqual(missing, ['HF_TOKEN'])
})

test('all required variables present for production satisfy preflight', () => {
  const missing = findMissingProductionEnvVariables({
    envs: REQUIRED_PRODUCTION_ENVIRONMENT_VARIABLES.map((key) => ({
      key,
      target: 'production'
    }))
  })

  assert.deepEqual(missing, [])
})

test('preview-only variables do not satisfy production readiness', () => {
  const missing = findMissingProductionEnvVariables([
    { key: 'NEXT_PUBLIC_SUPABASE_URL', target: ['production'] },
    { key: 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', target: ['production'] },
    { key: 'HF_TOKEN', target: ['preview'] }
  ])

  assert.deepEqual(missing, ['HF_TOKEN'])
})

test('supports a wrapped Vercel environment list response', () => {
  const missing = findMissingProductionEnvVariables({
    result: {
      envs: REQUIRED_PRODUCTION_ENVIRONMENT_VARIABLES.map((key) => ({
        key,
        targets: ['production']
      }))
    }
  })

  assert.deepEqual(missing, [])
})

test('rejects unknown environment-list response shapes without leaking payloads', () => {
  assert.throws(
    () => findMissingProductionEnvVariables({ unexpected: 'do-not-print-this-value' }),
    /Unsupported Vercel environment-variable list format/
  )
})


test('unknown environment targets do not count as production configuration', () => {
  const missing = findMissingProductionEnvVariables(
    REQUIRED_PRODUCTION_ENVIRONMENT_VARIABLES.map((key) => ({ key }))
  )

  assert.deepEqual(missing, [...REQUIRED_PRODUCTION_ENVIRONMENT_VARIABLES])
})

test('CLI prints no environment values even when JSON includes a secret value', () => {
  const helperPath = new URL('./helpers/verify-vercel-env.mjs', import.meta.url)
  const secretSentinel = 'FAKE_SECRET_SENTINEL_NOT_A_REAL_TOKEN'
  const input = JSON.stringify({
    envs: REQUIRED_PRODUCTION_ENVIRONMENT_VARIABLES.map((key) => ({
      key,
      target: ['production'],
      value: secretSentinel
    }))
  })

  const result = spawnSync(process.execPath, [helperPath.pathname], {
    encoding: 'utf8',
    input
  })

  assert.equal(result.status, 0)
  assert.match(result.stdout, /Required production environment variable names are present/)
  assert.doesNotMatch(result.stdout, new RegExp(secretSentinel))
  assert.doesNotMatch(result.stderr, new RegExp(secretSentinel))
})

test('CLI blocks a missing production HF token and never prints environment values', () => {
  const helperPath = new URL('./helpers/verify-vercel-env.mjs', import.meta.url)
  const secretSentinel = 'FAKE_SECRET_SENTINEL_NOT_A_REAL_TOKEN'
  const input = JSON.stringify({
    envs: [
      { key: 'NEXT_PUBLIC_SUPABASE_URL', target: ['production'], value: secretSentinel },
      { key: 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', target: ['production'], value: secretSentinel }
    ]
  })

  const result = spawnSync(process.execPath, [helperPath.pathname], {
    encoding: 'utf8',
    input
  })

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /HF_TOKEN/)
  assert.doesNotMatch(result.stdout, new RegExp(secretSentinel))
  assert.doesNotMatch(result.stderr, new RegExp(secretSentinel))
})
