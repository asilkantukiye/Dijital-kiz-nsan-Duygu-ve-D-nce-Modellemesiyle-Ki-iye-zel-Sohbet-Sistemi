import assert from 'node:assert/strict'
import test from 'node:test'

import { analyzeMessage, normalizeProfile, profileToSystemPrompt, TWIN_HEURISTIC_CONFIG, TWIN_MODEL_CALIBRATION_NOTE } from '../lib/twin.ts'

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

test('system prompt conditions only observable language-style indicators', () => {
  const prompt = profileToSystemPrompt({
    ...normalizeProfile(null),
    valence: 1,
    openness: 1,
    informality: 0.91,
    emoji_frequency: 0.12,
    humor: 0.83,
    slang: 0.77,
    avg_sentence_length: 0.42
  })

  assert.match(prompt, /DİLSEL İFADE PROFİLİ/i)
  assert.match(prompt, /deneysel/i)
  assert.match(prompt, /Emoji sıklığı: 0\\.12/)
  assert.match(prompt, /Mizah göstergesi: 0\\.83/)
  assert.match(prompt, /Argo\\/kısaltma göstergesi: 0\\.77/)
  assert.doesNotMatch(prompt, /valence|arousal|dominance|Big Five|openness|conscientiousness|extraversion|agreeableness|neuroticism/i)
  assert.match(prompt, /Duygu durumu, kişilik özelliği veya psikolojik durum çıkarımı/i)
  assert.match(prompt, /gerçek kimliğini taklit ettiğini/i)
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


test('heuristic baselines and weights are named, bounded, and explicitly uncalibrated', () => {
  assert.match(TWIN_MODEL_CALIBRATION_NOTE, /uncalibrated/i)
  assert.match(TWIN_MODEL_CALIBRATION_NOTE, /external validation/i)
  assert.equal(TWIN_HEURISTIC_CONFIG.smoothingAlpha, 0.25)
  for (const value of Object.values(TWIN_HEURISTIC_CONFIG.baseline)) {
    assert.ok(Number.isFinite(value))
    assert.ok(value >= 0 && value <= 1)
  }
  for (const value of Object.values(TWIN_HEURISTIC_CONFIG.weights)) {
    assert.ok(Number.isFinite(value))
    assert.ok(value >= 0 && value <= 25)
  }
})
