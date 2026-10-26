import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'

const USER_ID = '55555555-5555-4555-8555-555555555555'
const REQUEST_HASH = 'c'.repeat(64)
const CONCURRENT_REQUESTS = 24

function psql(sql) {
  return new Promise((resolve, reject) => {
    const child = spawn('psql', [
      '-X',
      '-qAt',
      '-v', 'ON_ERROR_STOP=1',
      '-c', sql
    ], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })

    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error('psql failed (' + code + '): ' + stderr.slice(0, 2000)))
        return
      }
      resolve(stdout.trim())
    })
  })
}

try {
  const results = await Promise.all(Array.from({ length: CONCURRENT_REQUESTS }, async () => {
    const owner = randomUUID()
    const sql = [
      'SET ROLE service_role;',
      "SET statement_timeout = '10000';",
      "SELECT disposition FROM public.claim_chat_request_server('" + USER_ID + "', '" + REQUEST_HASH + "', '" + owner + "'::uuid);"
    ].join('\n')
    return psql(sql)
  }))

  assert.equal(
    results.filter((result) => result === 'claimed').length,
    1,
    'exactly one of the concurrent duplicate requests must own the claim'
  )
  assert.equal(
    results.filter((result) => result === 'in_progress').length,
    CONCURRENT_REQUESTS - 1,
    'all other overlapping requests must observe the active claim'
  )

  const ownerToken = await psql([
    'SET ROLE service_role;',
    "SELECT owner_token::text FROM public.chat_request_deduplication",
    "WHERE user_id = '" + USER_ID + "'::uuid",
    "AND request_hash = '" + REQUEST_HASH + "'",
    "AND status = 'processing';"
  ].join('\n'))

  assert.match(ownerToken, /^[0-9a-f-]{36}$/i, 'claimed owner token must be persisted')
  await psql([
    'SET ROLE service_role;',
    "SELECT public.release_chat_request_server('" + USER_ID + "'::uuid, '" + REQUEST_HASH + "', '" + ownerToken + "'::uuid);"
  ].join('\n'))
} catch (error) {
  // Failures must not leave the synthetic processing claim behind for later tests.
  try {
    const token = await psql([
      'SET ROLE service_role;',
      "SELECT owner_token::text FROM public.chat_request_deduplication",
      "WHERE user_id = '" + USER_ID + "'::uuid",
      "AND request_hash = '" + REQUEST_HASH + "'",
      "AND status = 'processing';"
    ].join('\n'))
    if (/^[0-9a-f-]{36}$/i.test(token)) {
      await psql([
        'SET ROLE service_role;',
        "SELECT public.release_chat_request_server('" + USER_ID + "'::uuid, '" + REQUEST_HASH + "', '" + token + "'::uuid);"
      ].join('\n'))
    }
  } catch {
    // Preserve the original concurrency-test failure.
  }
  throw error
}
