import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const testDirectory = path.dirname(fileURLToPath(import.meta.url))
const projectDirectory = path.resolve(testDirectory, '..')

async function loadRoute(relativePath) {
  return readFile(path.join(projectDirectory, relativePath), 'utf8')
}

test('chat auth and rate-limit errors explicitly disable caching', async () => {
  const chat = await loadRoute('app/api/chat/route.ts')

  assert.match(
    chat,
    /error: 'Oturum bulunamadı\.'[\s\S]{0,140}status: 401, headers: \{ 'Cache-Control': 'no-store' \}/
  )
  assert.match(
    chat,
    /Çok fazla istek gönderildi\.[\s\S]{0,180}status: 429, headers: \{ 'Cache-Control': 'no-store' \}/
  )
})

test('feedback auth and message-ownership errors explicitly disable caching', async () => {
  const feedback = await loadRoute('app/api/feedback/route.ts')

  assert.match(
    feedback,
    /error: 'Oturum bulunamadı\.'[\s\S]{0,140}status: 401, headers: \{ 'Cache-Control': 'no-store' \}/
  )
  assert.match(
    feedback,
    /error: 'Mesaj bulunamadı\.'[\s\S]{0,140}status: 404, headers: \{ 'Cache-Control': 'no-store' \}/
  )
})
