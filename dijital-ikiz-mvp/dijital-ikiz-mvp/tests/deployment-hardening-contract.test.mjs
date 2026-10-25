import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const here = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.resolve(here, '..')
const repoRoot = path.resolve(appRoot, '..', '..')

test('production promotion follows staged configuration and upstream health checks', async () => {
  const workflow = await readFile(path.join(repoRoot, '.github', 'workflows', 'vercel-deploy.yml'), 'utf8')
  const stagedDeploy = workflow.indexOf('vercel@63.1.2 deploy --prebuilt --prod --skip-domain')
  const configHealth = workflow.indexOf('Verify production health and chat configuration')
  const deepHealth = workflow.indexOf('Verify production upstream connectivity')
  const promoteJob = workflow.indexOf('\n  promote:')
  const promotion = workflow.indexOf('vercel@63.1.2 promote')

  assert.ok(stagedDeploy >= 0, 'production deployment must be staged without assigning domains')
  assert.ok(configHealth > stagedDeploy, 'configuration readiness must follow staged deployment')
  assert.ok(deepHealth > configHealth, 'provider connectivity must follow configuration readiness')
  assert.ok(promoteJob > deepHealth && promotion > promoteJob, 'production promotion must only occur after both health gates')
  assert.match(workflow, /promote:[\s\S]*?environment:\s*production/)
  assert.match(workflow, /WORKFLOW_REF: \$\{\{ github\.ref \}\}/)
  assert.match(workflow, /HEALTHCHECK_TOKEN/)
  assert.match(workflow, /cancel-in-progress:\s*false/)
})

test('deep health secret is passed through a protected temporary header file', async () => {
  const workflow = await readFile(path.join(repoRoot, '.github', 'workflows', 'vercel-deploy.yml'), 'utf8')
  assert.match(workflow, /umask 077/)
  assert.match(workflow, /header_file="\$\(mktemp\)"/)
  assert.match(workflow, /x-healthcheck-token:/)
  assert.match(workflow, /Verify production upstream connectivity[\s\S]*?VERCEL_TOKEN: \$\{\{ secrets\.VERCEL_TOKEN \}\}/)
  assert.match(workflow, /trap 'rm -f "\$header_file"' EXIT/)
  assert.doesNotMatch(workflow, /-H ["']x-healthcheck-token:\s*\$HEALTHCHECK_TOKEN/)
  assert.doesNotMatch(workflow, /--token\s+["']?\$VERCEL_TOKEN/)
})

test('production CSP uses nonce-bound scripts, HSTS, and limited browser egress', async () => {
  const [csp, proxy, nextConfig] = await Promise.all([
    readFile(path.join(appRoot, 'lib', 'csp.ts'), 'utf8'),
    readFile(path.join(appRoot, 'proxy.ts'), 'utf8'),
    readFile(path.join(appRoot, 'next.config.ts'), 'utf8')
  ])

  assert.match(csp, /script-src 'self' 'nonce-\$\{nonce\}' 'strict-dynamic'/)
  assert.match(csp, /object-src 'none'/)
  assert.match(csp, /frame-ancestors 'none'/)
  assert.doesNotMatch(csp, /unsafe-eval/)
  assert.match(csp, /connect-src 'self' https:\/\/\*\.supabase\.co wss:\/\/\*\.supabase\.co/)
  assert.match(proxy, /process\.env\.NODE_ENV !== 'production'/)
  assert.match(proxy, /requestHeaderOverrides/)
  assert.match(nextConfig, /process\.env\.NODE_ENV === 'production'[\s\S]*?Strict-Transport-Security/)
})
