import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { normalizeProfile } from '../lib/twin.ts'

const testDirectory = path.dirname(fileURLToPath(import.meta.url))
const pagePath = path.resolve(testDirectory, '..', 'app', 'page.tsx')

test('the chat UI normalizes persisted profile JSON before rendering profile indicators', async () => {
  const page = await readFile(pagePath, 'utf8')

  assert.match(page, /import \{ normalizeProfile \} from '@\/lib\/twin'/)
  assert.match(
    page,
    /variant === 'personalized'\s*\? normalizeProfile\(storedProfile\?\.profile\)\s*: emptyProfile/
  )
  assert.doesNotMatch(page, /storedProfile\?\.profile as Profile/)
})

test('incomplete or invalid stored profiles render finite bounded metric values', () => {
  const profile = normalizeProfile({
    valence: 0.9,
    arousal: Number.NaN,
    extraversion: 9,
    unknownMetric: 0.5
  })

  assert.equal(profile.valence, 0.9)
  assert.equal(profile.arousal, 0.35)
  assert.equal(profile.extraversion, 1)
  assert.equal('unknownMetric' in profile, false)
  assert.ok(Object.values(profile).every((value) => Number.isFinite(value) && value >= 0 && value <= 1))
})
