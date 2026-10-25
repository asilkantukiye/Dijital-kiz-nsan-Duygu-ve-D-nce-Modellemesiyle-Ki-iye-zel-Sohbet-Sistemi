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
  assert.ok((workflow.match(/--scope "help-70c6"/g) ?? []).length >= 5)
  assert.match(workflow, /if: github\.ref == 'refs\/heads\/main'/)
  assert.match(workflow, /if:\s*\$\{\{\s*needs\.preflight\.outputs\.ready\s*==\s*'true'\s*\}\}/)
})

test('missing deployment prerequisites are explained without exposing secret values', async () => {
  const workflow = await readFile(workflowPath, 'utf8')

  assert.match(workflow, /## Vercel deployment not run/)
  assert.match(workflow, /VERCEL_TOKEN/)
  assert.match(workflow, /SUPABASE_PRODUCTION_SCHEMA_VERIFIED/)
  assert.match(workflow, /help-70c6/)
  for (const key of [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'HF_TOKEN',
    'UPSTASH_REDIS_REST_URL',
    'UPSTASH_REDIS_REST_TOKEN',
    'RATE_LIMIT_KEY_SALT'
  ]) assert.ok(workflow.includes(key), `Production preflight is missing ${key}`)
  assert.match(workflow, /values were not printed/)
  assert.match(workflow, /env ls production --scope "help-70c6" > "\$env_file" 2>&1/)
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
  assert.match(workflow, /vercel@63.1.2 deploy --prebuilt --prod --skip-domain/)
  assert.match(workflow, /vercel@63.1.2 pull --yes --environment=production/)
  assert.match(workflow, /vercel@63.1.2 build --prod/)
  assert.ok(workflow.includes('tests/helpers/extract-vercel-deployment-url.mjs'))
  assert.match(workflow, /echo "url=\$deployment_url" >> "\$GITHUB_OUTPUT"/)
  assert.match(workflow, /vercel@63.1.2 curl \/api\/health --deployment "\$DEPLOYMENT_URL"/)
  assert.match(workflow, /health\.ok !== true/)
  assert.match(workflow, /health\.ready !== true/)
  assert.match(workflow, /Staged production health smoke test passed/)
  const readiness = workflow.indexOf('Staged production health smoke test passed')
  const promotion = workflow.indexOf('vercel@63.1.2 promote')
  const productionAliasCheck = workflow.indexOf('Verify health through the production domain')
  assert.ok(readiness > 0 && promotion > readiness && productionAliasCheck > promotion, 'promotion must follow staged readiness and precede the production alias check')
})

test('Vercel Git integration cannot bypass gated production deployments on main', async () => {
  const [configText, workflow] = await Promise.all([
    readFile(vercelConfigPath, 'utf8'),
    readFile(workflowPath, 'utf8')
  ])
  const config = JSON.parse(configText)

  assert.equal(config.git?.deploymentEnabled?.main, false)
  assert.match(workflow, /vercel@63.1.2 deploy --prebuilt --prod --skip-domain/)
  assert.match(workflow, /SUPABASE_PRODUCTION_SCHEMA_VERIFIED/)
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
  assert.match(readme, /vercel deploy --prebuilt --prod --skip-domain/)
  assert.match(readme, /SUPABASE_PRODUCTION_SCHEMA_VERIFIED=true/)
  assert.match(readme, /staged sağlık kontrolü başarılı olursa/i)
  assert.match(readme, /SUPABASE_SERVICE_ROLE_KEY/)
  assert.match(readme, /RATE_LIMIT_KEY_SALT/)
})


test('production deployment is manual, uses a pinned CLI, and never passes the token as an argument', async () => {
  const workflow = await readFile(workflowPath, 'utf8')

  assert.match(workflow, /^on:\s*\n\s+workflow_dispatch:/m)
  assert.doesNotMatch(workflow, /^\s+push:\s*\n\s+branches:\s*\[\"main\"\]/m)
  assert.match(workflow, /environment: production/)
  assert.ok((workflow.match(/vercel@63\.1\.2/g) ?? []).length >= 5)
  assert.doesNotMatch(workflow, /vercel@latest/)
  assert.doesNotMatch(workflow, /--token\s+["']?\$\{\{\s*secrets\.VERCEL_TOKEN/)
  assert.doesNotMatch(workflow, /--token\s+["']?\$VERCEL_TOKEN/)
  assert.match(workflow, /VERCEL_TOKEN:\s*\$\{\{\s*secrets\.VERCEL_TOKEN\s*\}\}/)
})

test('README warns that the production Environment must be protected explicitly', async () => {
  const readme = await readFile(readmePath, 'utf8')

  assert.match(readme, /elle başlatılan/)
  assert.match(readme, /Environments → production/)
  assert.match(readme, /environment: production.*tek başına onay kapısı oluşturmaz/s)
})
