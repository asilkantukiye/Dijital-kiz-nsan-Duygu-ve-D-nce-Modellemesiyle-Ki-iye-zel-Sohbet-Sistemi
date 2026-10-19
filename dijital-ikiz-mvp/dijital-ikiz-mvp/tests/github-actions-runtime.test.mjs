import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const testDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryDirectory = path.resolve(testDirectory, '../../..')

async function readWorkflow(name) {
  return readFile(path.join(repositoryDirectory, '.github', 'workflows', name), 'utf8')
}

test('CI uses Node 24-compatible first-party GitHub Actions', async () => {
  const workflow = await readWorkflow('ci.yml')

  assert.match(workflow, /actions\/checkout@v7/)
  assert.match(workflow, /actions\/setup-node@v7/)
  assert.match(workflow, /actions\/setup-python@v7/)
  assert.doesNotMatch(workflow, /actions\/(?:checkout@v[1-6]|setup-node@v[1-6]|setup-python@v[1-6])/)
})

test('Vercel deployment workflow uses Node 24-compatible first-party Actions', async () => {
  const workflow = await readWorkflow('vercel-deploy.yml')

  assert.match(workflow, /actions\/checkout@v7/)
  assert.match(workflow, /actions\/setup-node@v7/)
  assert.doesNotMatch(workflow, /actions\/(?:checkout@v[1-6]|setup-node@v[1-6])/)
})

test('InfinityFree deployment workflow uses the current checkout action and FTPS action', async () => {
  const workflow = await readWorkflow('infinityfree-deploy.yml')

  assert.match(workflow, /actions\/checkout@v7/)
  assert.match(workflow, /SamKirkland\/FTP-Deploy-Action@v4\.4\.0/)
  assert.doesNotMatch(workflow, /actions\/checkout@v[1-6]/)
})

test('Kaggle workflow uses Node 24-compatible checkout, Python setup, and artifact actions', async () => {
  const workflow = await readWorkflow('kaggle-sentiment-pilot.yml')

  assert.match(workflow, /actions\/checkout@v7/)
  assert.match(workflow, /actions\/setup-python@v7/)
  assert.match(workflow, /actions\/upload-artifact@v7/)
  assert.doesNotMatch(workflow, /actions\/(?:checkout@v[1-6]|setup-python@v[1-6]|upload-artifact@v[1-6])/)
})
