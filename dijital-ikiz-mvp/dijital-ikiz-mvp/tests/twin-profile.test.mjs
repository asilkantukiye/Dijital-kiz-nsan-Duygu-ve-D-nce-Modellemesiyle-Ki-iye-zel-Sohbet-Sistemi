import assert from 'node:assert/strict'
import test from 'node:test'

import { analyzeMessage, normalizeProfile, profileToSystemPrompt } from '../lib/twin.ts'

test('normalizes missing, invalid, and out-of-range profile values', () => {
  assert.deepEqual(normalizeProfile(null), normalizeProfile({}))
  const profile = normalizeProfile({
    valence: 2,
    arousal: -1,
    dominance: Number.POSITIVE_INFINITY,
    openness: Number.NaN,
    conscientiousness: 0.8,
    unknownField: 100
  })

  assert.equal(profile.valence, 1)
  assert.equal(profile.arousal, 0)
  assert.equal(profile.dominance, 0.5)
  assert.equal(profile.openness, 0.5)
  assert.equal(profile.conscientiousness, 0.8)
  assert.equal('unknownField' in profile, false)
  for (const value of Object.values(profile)) {
    assert.ok(Number.isFinite(value))
    assert.ok(value >= 0 && value <= 1)
  }
})

test('first message creates bounded experimental indicators', () => {
  const profile = analyzeMessage('Harika!', null)

  assert.equal(profile.valence, 0.72)
  assert.equal(profile.arousal, 0.7)
  assert.ok(Object.values(profile).every((value) => value >= 0 && value <= 1))
})

test('profile updates apply the documented 25 percent current-message weighting', () => {
  const previous = normalizeProfile(null)
  const profile = analyzeMessage('Harika!', previous)

  assert.ok(Math.abs(profile.valence - 0.555) < 1e-10)
  assert.ok(Math.abs(profile.arousal - 0.4375) < 1e-10)
  assert.ok(Math.abs(profile.agreeableness - 0.52) < 1e-10)
})

test('system prompt labels profile as experimental and does not overstate identity', () => {
  const prompt = profileToSystemPrompt({
    ...normalizeProfile(null),
    valence: 9
  })

  assert.match(prompt, /deneysel bir modeldir/i)
  assert.match(prompt, /gerçek kimliğini taklit ettiğini/i)
  assert.match(prompt, /valence=1\.00/)
})

test('profile output is deterministic for the same message and previous state', () => {
  const previous = normalizeProfile({
    valence: 0.23,
    arousal: 0.62,
    dominance: 0.45
  })

  assert.deepEqual(
    analyzeMessage('Kanka bu çok harika 😂', previous),
    analyzeMessage('Kanka bu çok harika 😂', previous)
  )
})
