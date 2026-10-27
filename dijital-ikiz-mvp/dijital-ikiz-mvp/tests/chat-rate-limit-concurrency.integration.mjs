import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import test from 'node:test'

function callLimiter(digest, timestamp) {
  return new Promise((resolve, reject) => {
    const sql = `SET ROLE service_role; SELECT allowed, retry_after_seconds, reason FROM public.consume_chat_rate_limit('${digest}', '${timestamp}'::timestamptz); RESET ROLE;`
    const child = spawn('psql', ['-XAt', '-F', '|', '-v', 'ON_ERROR_STOP=1', '-c', sql], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.once('error', reject)
    child.once('close', (code) => {
      if (code !== 0) return reject(new Error('psql rate-limit call failed: ' + stderr.slice(0, 1200)))
      const row = stdout.split(/\r?\n/).map((line) => line.trim()).find((line) => /^[tf]\|/.test(line))
      if (!row) return reject(new Error('psql did not return a rate-limit decision'))
      const [allowed, retry, reason] = row.split('|')
      resolve({ allowed: allowed === 't', retry: Number(retry), reason })
    })
  })
}

test('parallel requests never exceed the atomic per-user rate limit', async () => {
  const userDigest = 'e'.repeat(64)
  const fixedTimestamp = '2099-12-31T12:34:00.000Z'
  const outcomes = await Promise.all(
    Array.from({ length: 40 }, () => callLimiter(userDigest, fixedTimestamp))
  )

  const allowed = outcomes.filter((item) => item.allowed)
  const blocked = outcomes.filter((item) => !item.allowed)
  assert.equal(allowed.length, 20)
  assert.equal(blocked.length, 20)
  assert.ok(blocked.every((item) => item.reason === 'user' && item.retry >= 1))
})
