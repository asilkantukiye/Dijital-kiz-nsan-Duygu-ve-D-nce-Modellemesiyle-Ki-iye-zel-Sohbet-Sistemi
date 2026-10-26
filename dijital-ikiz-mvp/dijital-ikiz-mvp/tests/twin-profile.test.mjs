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


test('profile remains finite and bounded across extreme alternating messages', () => {
  let profile = normalizeProfile({
    valence: 0,
    arousal: 1,
    dominance: 0,
    openness: 1,
    conscientiousness: 0,
    extraversion: 1,
    agreeableness: 0,
    neuroticism: 1,
    informality: 0,
    emoji_frequency: 1,
    humor: 0,
    slang: 1,
    avg_sentence_length: 0
  })

  const messages = ['harika çok seviyorum 😂!!!', 'berbat korku stres yalnız', 'kanka lol 🤣!!!', 'tamamen nötr bir cümle']
  for (let index = 0; index < 100_000; index += 1) {
    profile = analyzeMessage(messages[index % messages.length], profile)
    for (const [key, value] of Object.entries(profile)) {
      assert.ok(Number.isFinite(value), key + ' must remain finite at turn ' + index)
      assert.ok(value >= 0 && value <= 1, key + ' must remain in [0,1] at turn ' + index)
    }
  }
})

test('constant observations converge geometrically; arbitrary alternating inputs need not converge', () => {
  const target = analyzeMessage('Harika çok seviyorum 😂!!!', null)
  let profile = normalizeProfile(null)
  for (let index = 0; index < 100; index += 1) {
    profile = analyzeMessage('Harika çok seviyorum 😂!!!', profile)
  }

  for (const key of Object.keys(target)) {
    assert.ok(Math.abs(profile[key] - target[key]) < 1e-10, key + ' should converge to a constant observation')
  }

  let alternating = normalizeProfile(null)
  for (let index = 0; index < 10_000; index += 1) {
    alternating = analyzeMessage(index % 2 === 0 ? 'harika' : 'berbat', alternating)
  }
  for (const value of Object.values(alternating)) {
    assert.ok(Number.isFinite(value))
    assert.ok(value >= 0 && value <= 1)
  }
})
