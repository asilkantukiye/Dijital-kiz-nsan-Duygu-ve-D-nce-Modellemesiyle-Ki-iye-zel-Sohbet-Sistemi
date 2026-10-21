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
const vercelConfigPath = path.join(projectDirectory, 'vercel.json')

test('Vercel workflow requires a token and explicit Supabase migration confirmation', async () => {
  const workflow = await readFile(workflowPath, 'utf8')

  assert.match(workflow, /VERCEL_TOKEN:\s*\$\{\{\s*secrets\.VERCEL_TOKEN\s*\}\}/)
  assert.match(workflow, /SUPABASE_PRODUCTION_SCHEMA_VERIFIED:\s*\$\{\{\s*vars\.SUPABASE_PRODUCTION_SCHEMA_VERIFIED\s*\}\}/)
  assert.match(workflow, /SUPABASE_PRODUCTION_SCHEMA_VERIFIED" != "true"/)
  assert.match(workflow, /only after the baseline schema and all required migrations are applied/)
  assert.match(workflow, /RLS policies plus required RPC permissions\/functions are verified/)
  assert.doesNotMatch(workflow, /secrets\.VERCEL_ORG_ID/)
  assert.equal((workflow.match(/--scope "help-70c6"/g) ?? []).length, 3)
  assert.match(workflow, /if:\s*\$\{\{\s*needs\.preflight\.outputs\.ready\s*==\s*'true'\s*\}\}/)
})

test('missing deployment prerequisites are explained without exposing secret values', async () => {
  const workflow = await readFile(workflowPath, 'utf8')

  assert.match(workflow, /## Vercel deployment not run/)
  assert.match(workflow, /VERCEL_TOKEN/)
  assert.match(workflow, /SUPABASE_PRODUCTION_SCHEMA_VERIFIED/)
  assert.match(workflow, /help-70c6/)
  assert.ok(workflow.includes('for prerequisite in "${missing[@]}"; do'))
  assert.doesNotMatch(workflow, /echo "- `VERCEL_TOKEN`"/)
  assert.match(workflow, /Missing prerequisites mean no production deployment was attempted/)
  assert.match(workflow, /Never put the token in source code, workflow logs, issues, or chat/)
  assert.match(workflow, /leave the variable unset/)
  assert.match(workflow, /Deployment prerequisites are missing[^\n]*\n\s*exit 1/)
})

test('production deploy is gated on the full validation job', async () => {
  const workflow = await readFile(workflowPath, 'utf8')

  assert.match(workflow, /validate:\s*\n\s+needs: preflight/)
  assert.match(workflow, /if: \$\{\{ needs\.preflight\.outputs\.ready == 'true' \}\}/)
  assert.match(workflow, /needs: \[preflight, validate\]/)
  assert.match(workflow, /needs\.validate\.result == 'success'/)
  for (const command of [
    'python -m compileall -q ml',
    'python -m unittest discover -s ml/tests -p "test_*.py"',
    'npm run test:unit',
    'npm run typecheck',
    'npm run build'
  ]) {
    assert.ok(workflow.includes(command), `deployment validation missing: ${command}`)
  }
})


test('deployment URL parser handles CLI status messages and multiple URLs', () => {
  const output = [
    'Deploying production build...',
    'Inspect: https://vercel.com/team/project/abc123',
    'Production deployment: https://deploy-abc123-help-70c6.vercel.app',
    'Alias: https://dijital-ikiz-insan.vercel.app'
  ].join(String.fromCharCode(10))

  assert.equal(
    extractVercelDeploymentUrl(output),
    'https://deploy-abc123-help-70c6.vercel.app'
  )
})

test('deployment URL parser strips ANSI formatting and rejects invalid hosts/paths', () => {
  assert.equal(
    extractVercelDeploymentUrl(String.fromCharCode(27) + '[32mhttps://deploy-abc123.vercel.app' + String.fromCharCode(27) + '[0m'),
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

test('Vercel Git integration cannot bypass gated production deployments on main', async () => {
  const [configText, workflow] = await Promise.all([
    readFile(vercelConfigPath, 'utf8'),
    readFile(workflowPath, 'utf8')
  ])
  const config = JSON.parse(configText)

  assert.equal(config.git?.deploymentEnabled?.main, false)
  assert.match(workflow, /vercel@latest deploy --prod/)
  assert.match(workflow, /SUPABASE_PRODUCTION_SCHEMA_VERIFIED/)
})


test('hosting setup instructions match the actual Vercel workflow prerequisites', async () => {
  const hostingGuide = await readFile(
    path.join(projectDirectory, 'docs', 'hosting-setup.md'),
    'utf8'
  )
  const workflow = await readFile(workflowPath, 'utf8')

  assert.match(hostingGuide, /VERCEL_TOKEN/)
  assert.match(hostingGuide, /SUPABASE_PRODUCTION_SCHEMA_VERIFIED/)
  assert.match(hostingGuide, /VERCEL_ORG_ID.*istem[e]?z/i)
  assert.doesNotMatch(hostingGuide, /- `VERCEL_ORG_ID`:/)
  assert.match(hostingGuide, /INACTIVE/)
  assert.match(hostingGuide, /doğrulama ve dağıtım adımları çalıştırılmaz/)
  assert.match(workflow, /VERCEL_TOKEN:\s*\$\{\{\s*secrets\.VERCEL_TOKEN\s*\}\}/)
  assert.match(workflow, /SUPABASE_PRODUCTION_SCHEMA_VERIFIED/)
  assert.doesNotMatch(workflow, /secrets\.VERCEL_ORG_ID/)
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
