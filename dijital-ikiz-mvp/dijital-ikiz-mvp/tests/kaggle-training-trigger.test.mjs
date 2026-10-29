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
  assert.match(workflow, /INPUT_KERNEL_ID: \$\{\{ inputs\.kaggle_kernel_id \|\| vars\.KAGGLE_KERNEL_ID \|\| '' \}\}/)
  assert.match(workflow, /kernel_id = requested or f"\{username\}\/dijital-ikiz-training"/)
  assert.match(workflow, /Kaggle notebook owner does not match the authenticated account/)
  assert.match(workflow, /from kagglehub\.auth import whoami/)
})

test('the Kaggle workflow uses the common hardened private-LoRA publisher', async () => {
  const [workflow, publisher] = await Promise.all([
    readFile(workflowPath, 'utf8'),
    readFile(path.join(repositoryDirectory, 'dijital-ikiz-mvp', 'dijital-ikiz-mvp', 'ml', 'kaggle', 'publish_lora_to_hf.py'), 'utf8')
  ])

  assert.match(workflow, /kaggle kernels push --path ml\/kaggle --accelerator NvidiaTeslaT4/)
  assert.match(workflow, /kaggle kernels status "\$KERNEL_ID"/)
  assert.match(workflow, /No metrics\.json files found; refusing to publish unvalidated artifacts/)
  assert.match(workflow, /inputs\.hf_model_repo \|\| vars\.HF_MODEL_REPO \|\| 'hasankb00\/dijital-ikiz-qwen3-4b-lora'/)
  assert.match(workflow, /Publish Qwen LoRA adapter through the validated publisher/)
  assert.match(workflow, /python ml\/kaggle\/publish_lora_to_hf\.py/)
  assert.match(workflow, /--artifact-dir "\$GITHUB_WORKSPACE\/kaggle-output"/)
  assert.match(workflow, /--run-id "\$SOURCE_RUN_ID"/)
  assert.match(workflow, /github\.event_name == 'push'.*\[publish-model\]/)

  assert.match(publisher, /retry_with_backoff/)
  assert.match(publisher, /artifact-manifest\.json/)
  assert.match(publisher, /verify_remote_manifest/)
  assert.match(publisher, /Refusing to publish into a public Hugging Face repository/)
  assert.match(publisher, /Published file SHA-256 mismatch/)
})

test('manual training remains available without placing credentials in source', async () => {
  const workflow = await readFile(workflowPath, 'utf8')

  assert.match(workflow, /workflow_dispatch:/)
  assert.match(workflow, /KAGGLE_API_TOKEN: \$\{\{ secrets\.KAGGLE_KULLANABILEGIN_TOKEN \|\| secrets\.KAGGLE_KULLANABILECEGIN_TOKEN \|\| secrets\.KAGGLE_API_TOKEN \}\}/)
  assert.match(workflow, /HF_WRITE_TOKEN: \$\{\{ secrets\.HF_WRITE_TOKEN \}\}/)
  assert.doesNotMatch(workflow, /hf_[A-Za-z0-9]{30,}/)
  assert.doesNotMatch(workflow, /kaggle_[A-Za-z0-9]{30,}/)
})
