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
  assert.match(workflow, /HEALTHCHECK_TOKEN:\s*\$\{\{\s*secrets\.HEALTHCHECK_TOKEN\s*\}\}/)
  assert.match(workflow, /SUPABASE_PRODUCTION_SCHEMA_VERIFIED:\s*\$\{\{\s*vars\.SUPABASE_PRODUCTION_SCHEMA_VERIFIED\s*\}\}/)
  assert.match(workflow, /SUPABASE_PRODUCTION_SCHEMA_VERIFIED" != "true"/)
  assert.match(workflow, /only after the baseline schema and all required migrations are applied/)
  assert.match(workflow, /RLS policies plus required RPC permissions\/functions are verified/)
  assert.doesNotMatch(workflow, /secrets\.VERCEL_ORG_ID/)
  assert.ok((workflow.match(/--scope "help-70c6"/g) ?? []).length >= 5)
  assert.match(workflow, /WORKFLOW_REF: \$\{\{ github\.ref \}\}/)
  assert.match(workflow, /SOURCE_SHA: \$\{\{ github\.sha \}\}/)
  assert.match(workflow, /gh api "repos\/\$GITHUB_REPOSITORY\/commits\/main" --jq \.sha/)
  assert.match(workflow, /This run targets a stale main commit/)
  assert.match(workflow, /deployment must be dispatched from main/)
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
    'HF_MODEL',
    'HF_EMBEDDING_MODEL',
    'UPSTASH_REDIS_REST_URL',
    'UPSTASH_REDIS_REST_TOKEN',
    'RATE_LIMIT_KEY_SALT',
    'HEALTHCHECK_TOKEN'
  ]) assert.ok(workflow.includes(key), `Production preflight is missing ${key}`)
  assert.match(workflow, /values were not printed/)
  assert.match(workflow, /env ls production --scope "help-70c6" > "\$env_file" 2>&1/)
  assert.ok(workflow.includes('for prerequisite in "${missing[@]}"; do'))
  assert.doesNotMatch(workflow, /echo "- `VERCEL_TOKEN`"/)
  assert.match(workflow, /Missing prerequisites mean no production deployment was attempted/)
  assert.match(workflow, /Never put any token in source code, workflow logs, issues, or chat/)
  assert.match(workflow, /HF_WRITE_TOKEN.*model publication is a release prerequisite/)
  assert.match(workflow, /HEALTHCHECK_TOKEN.*minimum 32 characters/)
  assert.match(workflow, /leave the variable unset/)
  assert.match(workflow, /Deployment prerequisites are missing[^\n]*\n\s*exit 1/)
})

test('Production rechecks the exact main SHA before staging and before promotion', async () => {
  const workflow = await readFile(workflowPath, 'utf8')

  const stageGuard = workflow.indexOf('Recheck main tip before staging')
  const stageDeploy = workflow.indexOf('name: Deploy to Vercel production')
  const promoteGuard = workflow.indexOf('Recheck main tip immediately before promotion')
  const promoteCommand = workflow.indexOf('vercel@63.1.2 promote "$DEPLOYMENT_URL"')

  assert.ok(stageGuard > 0 && stageGuard < stageDeploy, 'main SHA must be checked before creating the staged deployment')
  assert.ok(promoteGuard > 0 && promoteGuard < promoteCommand, 'main SHA must be checked immediately before promotion')
  assert.ok((workflow.match(/gh api "repos\/\$GITHUB_REPOSITORY\/commits\/main" --jq \.sha/g) ?? []).length >= 3,
    'preflight, staging, and promotion must all query the remote main tip')
  assert.match(workflow, /refusing to stage a stale production build/)
  assert.match(workflow, /refusing to promote the stale artifact/)
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
  assert.ok(workflow.includes('curl /api/health/deep --deployment "$DEPLOYMENT_URL" --scope "help-70c6" -H "@$header_file"'), "deep health custom header must be forwarded to curl after the Vercel CLI separator")
  assert.match(workflow, /health\.ok !== true/)
  assert.match(workflow, /health\.ready !== true/)
  assert.match(workflow, /Staged production health smoke test passed/)
  const readiness = workflow.indexOf('Staged production health smoke test passed')
  const deepHealth = workflow.indexOf('Verify production upstream connectivity')
  const promotion = workflow.indexOf('vercel@63.1.2 promote')
  const promoteJob = workflow.indexOf('\n  promote:')
  const productionAliasCheck = workflow.indexOf('Verify health through the production domain')
  assert.ok(readiness > 0 && deepHealth > readiness && promotion > deepHealth && productionAliasCheck > promotion, 'promotion must follow staged config and upstream health checks')
  assert.ok(promoteJob > deepHealth && promotion > promoteJob, 'production approval/promotion job must not begin before upstream health passes')
  assert.match(workflow, /promote:[\s\S]*?environment:\s*production/)
  assert.match(workflow, /cancel-in-progress:\s*false/)
})

test('hosting guide requires Upstash and documents the fail-closed Production limiter', async () => {
  const hostingGuide = await readFile(path.join(projectDirectory, 'docs', 'hosting-setup.md'), 'utf8')

  assert.match(hostingGuide, /UPSTASH_REDIS_REST_URL.*Production için zorunlu/)
  assert.match(hostingGuide, /UPSTASH_REDIS_REST_TOKEN.*Production için zorunlu/)
  assert.match(hostingGuide, /Production'da rate limit yalnızca Upstash Redis üzerinden uygulanır/)
  assert.match(hostingGuide, /503.*Retry-After/)
  assert.doesNotMatch(hostingGuide, /Upstash değişkenleri isteğe bağlıdır/)
  assert.doesNotMatch(hostingGuide, /Supabase PostgreSQL tabanlı atomik rate-limit/)
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
  assert.match(readme, /Staged yapılandırma ve tüm upstream sağlık kontrolleri başarılı olduktan sonra/i)
  assert.match(readme, /SUPABASE_SERVICE_ROLE_KEY/)
  assert.match(readme, /RATE_LIMIT_KEY_SALT/)
  assert.match(readme, /HEALTHCHECK_TOKEN/)
  assert.match(readme, /Supabase Auth, Hugging Face token kimliği ve Upstash Redis REST `PING` kontrol edilir/)
})


test('custom Hugging Face chat endpoint is optional, allowlisted, and covered by unit tests', async () => {
  const [provider, envGate, envExample, readme, runbook] = await Promise.all([
    readFile(path.join(projectDirectory, 'lib', 'huggingface.ts'), 'utf8'),
    readFile(path.join(projectDirectory, 'scripts', 'check-production-env.mjs'), 'utf8'),
    readFile(path.join(projectDirectory, '.env.local.example'), 'utf8'),
    readFile(readmePath, 'utf8'),
    readFile(path.join(repositoryDirectory, '.github', 'PRODUCTION-RELEASE-RUNBOOK.md'), 'utf8')
  ])

  assert.match(provider, /resolveChatCompletionsUrl/)
  assert.match(provider, /url\.hostname === 'router\.huggingface\.co'/)
  assert.match(provider, /\.endpoints\.huggingface\.cloud/)
  assert.match(provider, /fetch\(chatCompletionsUrl/)
  assert.match(envGate, /HF_CHAT_COMPLETIONS_URL/)
  assert.match(envExample, /HF_CHAT_COMPLETIONS_URL=/)
  assert.match(readme, /LoRA adapter'ının Hugging Face Hub'a yüklenmesi, serverless Router'ın adapter'ı otomatik yüklemesi anlamına gelmez/)
  assert.match(runbook, /HF_CHAT_COMPLETIONS_URL/)
})

test('production smoke test checks missing deep-health token is hidden', async () => {
  const smoke = await readFile(path.join(projectDirectory, 'tests', 'production-smoke.mjs'), 'utf8')

  assert.match(smoke, /unauthenticatedDeepResponse\.status === 404/)
  assert.match(smoke, /x-healthcheck-token/)
  assert.match(smoke, /disclosed internal provider or diagnostic details/)
})

test('Kaggle model publication verifies GitHub artifact digest and records provenance', async () => {
  const [publishWorkflow, publisher, deployWorkflow] = await Promise.all([
    readFile(path.join(repositoryDirectory, '.github', 'workflows', 'publish-kaggle-lora.yml'), 'utf8'),
    readFile(path.join(projectDirectory, 'ml', 'kaggle', 'publish_lora_to_hf.py'), 'utf8'),
    readFile(workflowPath, 'utf8')
  ])

  assert.match(publishWorkflow, /actions\/runs\/\$SOURCE_RUN_ID\/artifacts/)
  assert.match(publishWorkflow, /artifact\.digest/)
  assert.match(publishWorkflow, /actions\/artifacts\/\$artifact_id\/zip/)
  assert.match(publishWorkflow, /actual_digest.*expected_digest/s)
  assert.match(publishWorkflow, /source-artifact-digest "\$source_digest"/)
  assert.match(publishWorkflow, /unsafe path/)
  assert.match(publishWorkflow, /symlinks are not allowed/)
  assert.match(publisher, /source-artifact-provenance\.json/)
  assert.match(publisher, /validate_source_artifact_digest/)
  assert.match(deployWorkflow, /source-artifact-provenance\.json/)
  assert.match(deployWorkflow, /source_artifact_digest/)
  assert.match(deployWorkflow, /source artifact provenance is missing or invalid/)
})

test('Production deployment verifies the private published LoRA before staging', async () => {
  const workflow = await readFile(workflowPath, 'utf8')

  assert.match(workflow, /Verify published Hugging Face LoRA adapter before Production deployment/)
  assert.match(workflow, /HF_WRITE_TOKEN/)
  assert.match(workflow, /hasankb00\/dijital-ikiz-qwen3-4b-lora/)
  assert.match(workflow, /adapter_config\.json/)
  assert.match(workflow, /adapter_model\.safetensors/)
  assert.match(workflow, /tokenizer_config\.json/)
  assert.match(workflow, /artifact-manifest\.json/)
  assert.match(workflow, /finetuned_model_test_loss/)
  assert.match(workflow, /info\.private is not True/)
  assert.match(workflow, /Production deployment is blocked/)
  assert.ok(
    workflow.indexOf('Verify published Hugging Face LoRA adapter before Production deployment') <
    workflow.indexOf('  validate:'),
    'Published adapter verification must run before the deployment validation/staging jobs'
  )
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


test('Production environment gate validates optional dedicated Hugging Face endpoint configuration', async () => {
  const [workflow, gate] = await Promise.all([
    readFile(workflowPath, 'utf8'),
    readFile(path.join(projectDirectory, 'scripts', 'check-production-env.mjs'), 'utf8')
  ])

  assert.match(workflow, /HF_MODEL \\\n\\s+HF_EMBEDDING_MODEL/)
  assert.match(gate, /HF_CHAT_COMPLETIONS_URL/)
  assert.match(gate, /router\\.huggingface\\.co/)
  assert.match(gate, /endpoints\\.huggingface\\.cloud/)
  assert.match(gate, /url\\.pathname === '\/v1\/chat\/completions'/)
})

test('README warns that the production Environment must be protected explicitly', async () => {
  const readme = await readFile(readmePath, 'utf8')

  assert.match(readme, /elle başlatılan/)
  assert.match(readme, /Environments → production/)
  assert.match(readme, /environment: production.*tek başına onay kapısı oluşturmaz/s)
})
