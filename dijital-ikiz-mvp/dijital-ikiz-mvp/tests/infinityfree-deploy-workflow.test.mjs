import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const testDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryDirectory = path.resolve(testDirectory, '../../..')
const workflowPath = path.join(repositoryDirectory, '.github', 'workflows', 'infinityfree-deploy.yml')
const readmePath = path.join(repositoryDirectory, 'infinityfree', 'README.md')

test('InfinityFree deployment uses encrypted explicit FTPS with certificate validation', async () => {
  const workflow = await readFile(workflowPath, 'utf8')

  assert.match(workflow, /protocol:\s*ftps\b/)
  assert.match(workflow, /port:\s*21\b/)
  assert.match(workflow, /security:\s*strict\b/)
  assert.doesNotMatch(workflow, /protocol:\s*ftp\s*$/m)
})

test('InfinityFree deployment reads credentials from secrets, not source values', async () => {
  const workflow = await readFile(workflowPath, 'utf8')

  for (const name of [
    'INFINITYFREE_FTP_SERVER',
    'INFINITYFREE_FTP_USERNAME',
    'INFINITYFREE_FTP_PASSWORD'
  ]) {
    assert.match(workflow, new RegExp('secrets\\.' + name))
  }

  assert.match(workflow, /dangerous-clean-slate:\s*false/)
})

test('skipped InfinityFree upload is explained without shell interpolation', async () => {
  const workflow = await readFile(workflowPath, 'utf8')

  assert.match(workflow, /## InfinityFree landing page upload not run/)
  assert.match(workflow, /INFINITYFREE_FTP_SERVER/)
  assert.match(workflow, /INFINITYFREE_FTP_USERNAME/)
  assert.match(workflow, /INFINITYFREE_FTP_PASSWORD/)
  assert.match(workflow, /A green preflight with a skipped upload job does not mean the landing page was updated/)
  assert.match(workflow, /echo \\\"::error::InfinityFree upload requires[\\s\\S]*?exit 1/)
})

test('InfinityFree setup guide documents FTPS and the static landing-page scope', async () => {
  const readme = await readFile(readmePath, 'utf8')

  assert.match(readme, /şifrelenmiş explicit FTPS/)
  assert.match(readme, /ana Next\.js sohbet uygulamasını değil/)
  assert.match(readme, /Settings → Secrets and variables → Actions/)
})
