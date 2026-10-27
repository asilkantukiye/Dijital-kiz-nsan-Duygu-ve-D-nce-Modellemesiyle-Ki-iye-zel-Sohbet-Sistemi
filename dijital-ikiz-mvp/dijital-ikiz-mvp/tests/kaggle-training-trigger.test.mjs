import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const testDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryDirectory = path.resolve(testDirectory, '../../..')
const workflowPath = path.join(repositoryDirectory, '.github', 'workflows', 'kaggle-end-to-end-training.yml')

test('Kaggle training can only auto-run from a specially tagged main commit', async () => {
  const workflow = await readFile(workflowPath, 'utf8')

  assert.match(workflow, /^on:\s*\n\s+push:\s*\n\s+branches: \["main"\]/m)
  assert.match(workflow, /paths:[\s\S]*\.github\/workflows\/kaggle-end-to-end-training\.yml[\s\S]*ml\/kaggle\/dijital_ikiz_training\.ipynb/)
  assert.match(workflow, /github\.event_name == 'workflow_dispatch'/)
  assert.match(workflow, /contains\(github\.event\.head_commit\.message, '\[run-kaggle-training\]'\)/)
  assert.match(workflow, /INPUT_KERNEL_ID: \$\{\{ inputs\.kaggle_kernel_id \|\| vars\.KAGGLE_KERNEL_ID \|\| 'asilkantkiye\/dijital-ikiz-training' \}\}/)
})

test('the guarded run publishes only validated Qwen LoRA artifacts to a private model repository', async () => {
  const workflow = await readFile(workflowPath, 'utf8')

  assert.match(workflow, /kaggle kernels push --path ml\/kaggle --accelerator NvidiaTeslaT4/)
  assert.match(workflow, /kaggle kernels status "\$KERNEL_ID"/)
  assert.match(workflow, /No metrics\.json files found; refusing to publish unvalidated artifacts/)
  assert.match(workflow, /inputs\.hf_model_repo \|\| vars\.HF_MODEL_REPO \|\| 'hasankb00\/dijital-ikiz-qwen3-4b-lora'/)
  assert.match(workflow, /repo_info\.private/)
  assert.match(workflow, /api\.upload_folder\(/)
  assert.match(workflow, /github\.event_name == 'push'.*\[run-kaggle-training\]/)
})

test('manual training remains available without placing credentials in source', async () => {
  const workflow = await readFile(workflowPath, 'utf8')

  assert.match(workflow, /workflow_dispatch:/)
  assert.match(workflow, /KAGGLE_API_TOKEN: \$\{\{ secrets\.KAGGLE_KULLANABILEGIN_TOKEN \|\| secrets\.KAGGLE_KULLANABILECEGIN_TOKEN \|\| secrets\.KAGGLE_API_TOKEN \}\}/)
  assert.match(workflow, /HF_WRITE_TOKEN: \$\{\{ secrets\.HF_WRITE_TOKEN \}\}/)
  assert.doesNotMatch(workflow, /hf_[A-Za-z0-9]{30,}/)
  assert.doesNotMatch(workflow, /kaggle_[A-Za-z0-9]{30,}/)
})
