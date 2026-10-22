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


test('CI and Vercel validation use the committed npm lockfile reproducibly', async () => {
  const projectDirectory = path.resolve(testDirectory, '..')
  const [ci, deploy, packageText, lockText] = await Promise.all([
    readWorkflow('ci.yml'),
    readWorkflow('vercel-deploy.yml'),
    readFile(path.join(projectDirectory, 'package.json'), 'utf8'),
    readFile(path.join(projectDirectory, 'package-lock.json'), 'utf8')
  ])

  const packageJson = JSON.parse(packageText)
  const packageLock = JSON.parse(lockText)
  const install = packageLock.packages?.['']

  assert.ok(install, 'lockfile root package metadata must exist')
  assert.equal(packageLock.lockfileVersion, 3)
  assert.deepEqual(install.dependencies, packageJson.dependencies)
  assert.deepEqual(install.devDependencies, packageJson.devDependencies)
  assert.deepEqual(install.engines, packageJson.engines)

  assert.match(ci, /cache-dependency-path: dijital-ikiz-mvp\/dijital-ikiz-mvp\/package-lock\.json/)
  assert.match(ci, /run: npm ci\b/)
  assert.doesNotMatch(ci, /run: npm install\b/)

  assert.equal((deploy.match(/cache-dependency-path:.*package-lock\.json/g) ?? []).length, 2)
  assert.match(deploy, /run: npm ci\b/)
  assert.doesNotMatch(deploy, /run: npm install\b/)
})
