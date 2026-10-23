import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const here = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.resolve(here, '..')
const repoRoot = path.resolve(appRoot, '..', '..')

test('production deployment is staged and promoted only after health gates', async () => {
  const workflow = await readFile(path.join(repoRoot, '.github', 'workflows', 'vercel-deploy.yml'), 'utf8')
  const stagedDeploy = workflow.indexOf('vercel@63.1.2 deploy --prod --skip-domain')
  const configHealth = workflow.indexOf('Verify production health and chat configuration')
  const deepHealth = workflow.indexOf('Verify production upstream connectivity')
  const promotion = workflow.indexOf('vercel@63.1.2 promote')

  assert.ok(stagedDeploy >= 0, 'deploy command should be pinned and staged without domains')
  assert.ok(configHealth > stagedDeploy, 'configuration health must run after staged deploy')
  assert.ok(deepHealth > configHealth, 'provider network probe must run after configuration health')
  assert.ok(promotion > deepHealth, 'production promotion must happen last')
  assert.match(workflow, /environment:\s*production/)
})

test('deploy workflow avoids floating CLI tags and command-line token arguments', async () => {
  const workflow = await readFile(path.join(repoRoot, '.github', 'workflows', 'vercel-deploy.yml'), 'utf8')
  assert.doesNotMatch(workflow, /vercel@latest/i)
  assert.doesNotMatch(workflow, /--token\s+["']?\$VERCEL_TOKEN/i)
  assert.match(workflow, /HEALTHCHECK_TOKEN/)
  assert.match(workflow, /SUPABASE_PRODUCTION_SCHEMA_VERIFIED/)
  assert.match(workflow, /cancel-in-progress:\s*false/)
})

test('deployment health probe sends its shared secret through a temporary header file', async () => {
  const workflow = await readFile(path.join(repoRoot, '.github', 'workflows', 'vercel-deploy.yml'), 'utf8')
  assert.match(workflow, /umask 077/)
  assert.match(workflow, /mktemp/)
  assert.match(workflow, /x-healthcheck-token:/)
  assert.match(workflow, /trap .*rm -f/)
})
