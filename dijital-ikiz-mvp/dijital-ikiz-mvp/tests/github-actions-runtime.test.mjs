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

test('CI and deployment validation use the committed npm lockfile reproducibly', async () => {
  const [ci, deploy, packageText, lockText] = await Promise.all([
    readWorkflow('ci.yml'),
    readWorkflow('vercel-deploy.yml'),
    readFile(path.join(repositoryDirectory, 'dijital-ikiz-mvp', 'dijital-ikiz-mvp', 'package.json'), 'utf8'),
    readFile(path.join(repositoryDirectory, 'dijital-ikiz-mvp', 'dijital-ikiz-mvp', 'package-lock.json'), 'utf8')
  ])

  const packageJson = JSON.parse(packageText)
  const lock = JSON.parse(lockText)

  assert.match(ci, /run: npm ci/)
  assert.match(deploy, /run: npm ci/)
  assert.match(ci, /cache-dependency-path: dijital-ikiz-mvp\/dijital-ikiz-mvp\/package-lock\.json/)
  assert.match(deploy, /cache-dependency-path: dijital-ikiz-mvp\/dijital-ikiz-mvp\/package-lock\.json/)
  assert.equal(lock.lockfileVersion, 3)
  assert.equal(lock.packages[''].name, packageJson.name)
  assert.equal(lock.packages[''].version, packageJson.version)
  assert.deepEqual(lock.packages[''].dependencies, packageJson.dependencies)
  assert.deepEqual(lock.packages[''].devDependencies, packageJson.devDependencies)
})

test('Kaggle training pins the CLI version used by the workflow', async () => {
  const workflow = await readWorkflow('kaggle-sentiment-pilot.yml')

  assert.match(workflow, /python -m pip install "kaggle==1\.8\.4"/)
  assert.doesNotMatch(workflow, /python -m pip install "kaggle>=/)
})
