import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { extractVercelDeploymentUrl } from './helpers/extract-vercel-deployment-url.mjs'

const testDirectory = path.dirname(fileURLToPath(import.meta.url))
const projectDirectory = path.resolve(testDirectory, '..')
const repositoryDirectory = path.resolve(testDirectory, '../../..')
const workflowPath = path.join(repositoryDirectory, '.github', 'workflows', 'vercel-deploy.yml')
const readmePath = path.join(projectDirectory, 'README.md')

test('Vercel workflow requires one access token and a configured team scope', async () => {
  const workflow = await readFile(workflowPath, 'utf8')

  assert.match(workflow, /VERCEL_TOKEN:\s*\$\{\{\s*secrets\.VERCEL_TOKEN\s*\}\}/)
  assert.doesNotMatch(workflow, /secrets\.VERCEL_ORG_ID/)
  assert.equal((workflow.match(/--scope "help-70c6"/g) ?? []).length, 3)
  assert.match(workflow, /if:\s*\$\{\{\s*needs\.preflight\.outputs\.ready\s*==\s*'true'\s*\}\}/)
})

test('skipped production deployment is explained without exposing secret values', async () => {
  const workflow = await readFile(workflowPath, 'utf8')

  assert.match(workflow, /## Vercel deployment not run/)
  assert.match(workflow, /VERCEL_TOKEN/)
  assert.match(workflow, /The team scope is configured as help-70c6/)
  assert.match(workflow, /echo "- VERCEL_TOKEN"/)
  assert.doesNotMatch(workflow, /echo "- `VERCEL_TOKEN`"/)
  assert.match(workflow, /A green preflight with a skipped deploy job does not mean production was updated/)
  assert.match(workflow, /Never put the token in source code, workflow logs, issues, or chat/)
})


test('deployment URL parser handles CLI status messages and multiple URLs', () => {
  const output = [
    'Deploying production build...',
    'Inspect: https://vercel.com/team/project/abc123',
    'Production deployment: https://deploy-abc123-help-70c6.vercel.app',
    'Alias: https://dijital-ikiz-insan.vercel.app'
  ].join('\\n')

  assert.equal(
    extractVercelDeploymentUrl(output),
    'https://deploy-abc123-help-70c6.vercel.app'
  )
})

test('deployment URL parser handles ANSI formatting and rejects external hosts', () => {
  assert.equal(
    extractVercelDeploymentUrl('\\u001b[32mhttps://deploy-abc123.vercel.app\\u001b[0m'),
    'https://deploy-abc123.vercel.app'
  )

  assert.throws(
    () => extractVercelDeploymentUrl('https://deploy-abc123.vercel.app.attacker.example'),
    /valid HTTPS deployment URL/
  )
  assert.throws(
    () => extractVercelDeploymentUrl('https://deploy-abc123.vercel.app/unexpected-path'),
    /valid HTTPS deployment URL/
  )
})

test('production deployment URL is captured and health/readiness is checked afterward', async () => {
  const workflow = await readFile(workflowPath, 'utf8')

  assert.match(workflow, /id: deployment/)
  assert.match(workflow, /vercel@latest deploy --prod/)
  assert.ok(workflow.includes('tests/helpers/extract-vercel-deployment-url.mjs'))
  assert.match(workflow, /echo "url=\$deployment_url" >> "\$GITHUB_OUTPUT"/)
  assert.match(workflow, /vercel@latest curl \/api\/health --deployment "\$DEPLOYMENT_URL"/)
  assert.match(workflow, /health\.ok !== true/)
  assert.match(workflow, /health\.ready !== true/)
  assert.match(workflow, /Production health smoke test passed/)
})

test('README documents how to configure the deploy workflow and verify deployment', async () => {
  const readme = await readFile(readmePath, 'utf8')

  assert.match(readme, /GitHub Actions üzerinden dağıtım/)
  assert.match(readme, /Settings → Secrets and variables → Actions/)
  assert.match(readme, /VERCEL_TOKEN/)
  assert.match(readme, /VERCEL_ORG_ID.*gerekmez/i)
  assert.match(readme, /help-70c6/)
  assert.match(readme, /üretim güncellenmiş değildir/)
  assert.match(readme, /\/api\/health/)
  assert.match(readme, /gerçek model çıkarımının başarılı olduğunu tek başına kanıtlamaz/)
})
