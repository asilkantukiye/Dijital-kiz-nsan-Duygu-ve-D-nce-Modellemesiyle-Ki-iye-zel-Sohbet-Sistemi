import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const testDirectory = path.dirname(fileURLToPath(import.meta.url))
const projectDirectory = path.resolve(testDirectory, '..')
const repositoryDirectory = path.resolve(testDirectory, '../../..')
const workflowPath = path.join(repositoryDirectory, '.github', 'workflows', 'vercel-deploy.yml')
const readmePath = path.join(projectDirectory, 'README.md')

test('Vercel workflow requires the two deployment secrets before running deploy', async () => {
  const workflow = await readFile(workflowPath, 'utf8')

  assert.match(workflow, /VERCEL_TOKEN:\s*\$\{\{\s*secrets\.VERCEL_TOKEN\s*\}\}/)
  assert.match(workflow, /VERCEL_ORG_ID:\s*\$\{\{\s*secrets\.VERCEL_ORG_ID\s*\}\}/)
  assert.match(workflow, /if:\s*\$\{\{\s*needs\.preflight\.outputs\.ready\s*==\s*'true'\s*\}\}/)
})

test('skipped production deployment is explained in the Actions summary without exposing secret values', async () => {
  const workflow = await readFile(workflowPath, 'utf8')

  assert.match(workflow, /## Vercel deployment not run/)
  assert.match(workflow, /VERCEL_TOKEN/)
  assert.match(workflow, /VERCEL_ORG_ID/)
  // Keep literal backticks out of double-quoted shell echo strings: Bash
  // interprets them as command substitution rather than Markdown formatting.
  assert.match(workflow, /echo "- VERCEL_TOKEN"/)
  assert.match(workflow, /echo "- VERCEL_ORG_ID"/)
  assert.doesNotMatch(workflow, /echo "- `VERCEL_TOKEN`"/)
  assert.doesNotMatch(workflow, /echo "- `VERCEL_ORG_ID`"/)
  assert.match(workflow, /A green preflight with a skipped deploy job does not mean production was updated/)
  assert.match(workflow, /Never put the token in source code, workflow logs, issues, or chat/)
})

test('README documents how to configure the deploy workflow and verify deployment', async () => {
  const readme = await readFile(readmePath, 'utf8')

  assert.match(readme, /GitHub Actions üzerinden dağıtım/)
  assert.match(readme, /Settings → Secrets and variables → Actions/)
  assert.match(readme, /VERCEL_TOKEN/)
  assert.match(readme, /VERCEL_ORG_ID/)
  assert.match(readme, /üretim güncellenmiş değildir/)
})
