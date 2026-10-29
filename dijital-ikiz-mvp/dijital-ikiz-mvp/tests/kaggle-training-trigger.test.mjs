import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const testDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryDirectory = path.resolve(testDirectory, '../../..')
const workflowPath = path.join(repositoryDirectory, '.github', 'workflows', 'kaggle-end-to-end-training.yml')
const autonomousWorkflowPath = path.join(repositoryDirectory, '.github', 'workflows', 'kaggle-sentiment-pilot.yml')
const publisherPath = path.join(repositoryDirectory, 'dijital-ikiz-mvp', 'dijital-ikiz-mvp', 'ml', 'kaggle', 'publish_lora_to_hf.py')

test('Kaggle training is available by dispatch or a tagged main commit', async () => {
  const [wrapper, workflow] = await Promise.all([
    readFile(workflowPath, 'utf8'),
    readFile(autonomousWorkflowPath, 'utf8')
  ])

  assert.match(wrapper, /^on:\s*\n\s+push:\s*\n\s+branches: \["main"\]/m)
  assert.match(wrapper, /paths:[\s\S]*\.github\/workflows\/kaggle-end-to-end-training\.yml[\s\S]*dijital-ikiz-mvp\/dijital-ikiz-mvp\/ml\/kaggle\/\*\*/)
  assert.match(wrapper, /github\.event_name == 'workflow_dispatch'/)
  assert.match(wrapper, /contains\(github\.event\.head_commit\.message, '\[run-kaggle-training\]'\)/)
  assert.match(wrapper, /uses: \.\/\.github\/workflows\/kaggle-sentiment-pilot\.yml/)
  assert.match(wrapper, /secrets: inherit/)

  assert.match(workflow, /workflow_call:/)
  assert.match(workflow, /workflow_dispatch:/)
  assert.match(workflow, /INPUT_KERNEL_ID: \$\{\{ inputs\.kaggle_kernel_id \|\| vars\.KAGGLE_KERNEL_ID \|\| '' \}\}/)
  assert.match(workflow, /kernel_id = requested or f"\{username\}\/dijital-ikiz-training"/)
  assert.match(workflow, /Kaggle notebook owner does not match the authenticated account/)
  assert.match(workflow, /from kagglehub\.auth import whoami/)
})

test('the autonomous Kaggle job executes, polls, validates and publishes one pinned Qwen adapter', async () => {
  const [workflow, publisher] = await Promise.all([
    readFile(autonomousWorkflowPath, 'utf8'),
    readFile(publisherPath, 'utf8')
  ])

  assert.match(workflow, /kaggle kernels push --path ml\/kaggle --accelerator "\$INPUT_ACCELERATOR"/)
  const submitStep = workflow.rsplit
    ? workflow.rsplit('- name: Submit notebook and start Kaggle training', 1)[1]
    : workflow.split('- name: Submit notebook and start Kaggle training').at(-1)
  assert.ok(submitStep)
  assert.doesNotMatch(submitStep.split('\n      - name:', 1)[0], /--no-run/)
  assert.match(workflow, /kaggle kernels status "\$KERNEL_ID"/)
  assert.match(workflow, /kaggle kernels output "\$KERNEL_ID"/)
  assert.match(workflow, /Consolidated training-metrics\.json is missing/)
  assert.match(workflow, /scientific-validation-report\.md/)
  assert.match(workflow, /inputs\.hf_model_repo \|\| vars\.HF_MODEL_REPO \|\| 'hasankb00\/dijital-ikiz-qwen3-4b-lora'/)
  assert.match(workflow, /Publish Qwen LoRA adapter through the validated publisher/)
  assert.match(workflow, /python ml\/kaggle\/publish_lora_to_hf\.py/)
  assert.match(workflow, /--artifact-dir "\$GITHUB_WORKSPACE\/kaggle-output"/)
  assert.match(workflow, /--run-id "\$SOURCE_RUN_ID"/)
  assert.match(workflow, /--source-artifact-digest "\$source_digest"/)
  assert.match(workflow, /default: true/)

  assert.match(publisher, /retry_with_backoff/)
  assert.match(publisher, /training-metrics\.json/)
  assert.match(publisher, /artifact-manifest\.json/)
  assert.match(publisher, /verify_remote_manifest/)
  assert.match(publisher, /Refusing to publish into a public Hugging Face repository/)
  assert.match(publisher, /Published file SHA-256 mismatch/)
  assert.match(publisher, /\-\-source-artifact-digest/)
})

test('manual training keeps credentials in repository secrets and never source code', async () => {
  const [wrapper, workflow] = await Promise.all([
    readFile(workflowPath, 'utf8'),
    readFile(autonomousWorkflowPath, 'utf8')
  ])
  const combined = wrapper + workflow

  assert.match(wrapper, /workflow_dispatch:/)
  assert.match(workflow, /KAGGLE_API_TOKEN: \$\{\{ secrets\.KAGGLE_KULLABILEGIN_TOKEN \|\| secrets\.KAGGLE_KULLANABILECEGIN_TOKEN \|\| secrets\.KAGGLE_API_TOKEN \}\}/)
  assert.match(workflow, /HF_WRITE_TOKEN: \$\{\{ secrets\.HF_WRITE_TOKEN \}\}/)
  assert.doesNotMatch(combined, /hf_[A-Za-z0-9]{30,}/)
  assert.doesNotMatch(combined, /kaggle_[A-Za-z0-9]{30,}/)
})
