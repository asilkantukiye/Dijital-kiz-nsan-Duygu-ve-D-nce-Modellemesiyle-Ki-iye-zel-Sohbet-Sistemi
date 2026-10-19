import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const testDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryDirectory = path.resolve(testDirectory, '../../..')
const landingPagePath = path.join(repositoryDirectory, 'infinityfree', 'index.html')

test('landing page does not publish a placeholder Vercel URL', async () => {
  const html = await readFile(landingPagePath, 'utf8')

  assert.doesNotMatch(html, /YOUR-VERCEL-DOMAIN/i)
  assert.doesNotMatch(html, /href=["']https:\/\/[^"']*\.vercel\.app/i)
})

test('landing page links to the real repository and clearly states deployment status', async () => {
  const html = await readFile(landingPagePath, 'utf8')

  assert.match(
    html,
    /href="https:\/\/github\.com\/asilkantukiye\/Dijital-kiz-nsan-Duygu-ve-D-nce-Modellemesiyle-Ki-iye-zel-Sohbet-Sistemi"/
  )
  assert.match(html, /Canl[ıi] sohbet uygulamas[ıi]n[ıi]n yay[ıi]na al[ıi]nmas[ıi] hen[üu]z tamamlanmad[ıi]/i)
  assert.match(html, /rel="noopener noreferrer"/)
})

