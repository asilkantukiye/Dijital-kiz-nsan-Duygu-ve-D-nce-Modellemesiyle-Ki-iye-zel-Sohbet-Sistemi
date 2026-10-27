import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const testDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryDirectory = path.resolve(testDirectory, '../../..')
const workflowPath = path.join(repositoryDirectory, '.github', 'workflows', 'confirm-supabase-production-schema.yml')
const deploymentWorkflowPath = path.join(repositoryDirectory, '.github', 'workflows', 'vercel-deploy.yml')

test('Supabase production guard requires an explicit repository-variable token', async () => {
  const workflow = await readFile(workflowPath, 'utf8')
  const deploymentWorkflow = await readFile(deploymentWorkflowPath, 'utf8')

  assert.match(workflow, /GH_VARIABLES_TOKEN: \$\{\{ secrets\.GH_VARIABLES_TOKEN \}\}/)
  assert.match(workflow, /if \[\[ -z "\$\{GH_VARIABLES_TOKEN:-\}" \]\]/)
  assert.match(workflow, /GH_TOKEN="\$GH_VARIABLES_TOKEN" gh variable set SUPABASE_PRODUCTION_SCHEMA_VERIFIED/)
  assert.match(workflow, /GH_TOKEN="\$GH_VARIABLES_TOKEN" gh variable list/)
  assert.match(workflow, /\[\[ "\$set_exit" -eq 0 && "\$read_exit" -eq 0 && "\$value" == "true" \]\]/)
  assert.match(workflow, /if \[\[ "\$verified" != "true" \]\]/)
  assert.match(deploymentWorkflow, /SUPABASE_PRODUCTION_SCHEMA_VERIFIED/)
})

test('missing repository-variable credentials fail closed without exposing a token', async () => {
  const workflow = await readFile(workflowPath, 'utf8')

  assert.match(workflow, /result="GH_VARIABLES_TOKEN_secret_missing"/)
  assert.match(workflow, /repository guard was \\*\\*not\\*\\* changed/)
  assert.match(workflow, /secrets_included: false/)
  assert.doesNotMatch(workflow, /github\.token/)
})
