import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildProfile,
  buildSystemPrompt,
  createBalancedConditionOrder,
  createBalancedConditionOrderByProfile,
  createBlindPair,
  deriveCaseSeed,
  shuffleCases,
} from '../scripts/run-style-ab-evaluation.mjs'

test('style profile is derived from text examples and prompt is limited to language style', () => {
  const profile = buildProfile([
    'Ya selam, bugün baya yoğundum ama işlerimi bitirdim!',
    'Bence bunu daha kısa anlatsak çok iyi olur.',
    'Harika olmuş, eline sağlık 😄',
  ])

  const prompt = buildSystemPrompt(profile)
  assert.match(prompt, /DİLSEL İFADE PROFİLİ/)
  assert.match(prompt, /yalnızca metinde gözlenen ifade tercihleri/)
  assert.match(prompt, /Psikolojik tanı koyma/)
})

test('general and personalized system prompts differ by style profile context', () => {
  const general = buildSystemPrompt()
  const profile = buildProfile(['Merhaba, bugün çalışmamı tamamladım.', 'Görüşünüzü rica ederim.'])
  const personalized = buildSystemPrompt(profile)

  assert.match(general, /genel yanıt koşuludur/)
  assert.match(personalized, /DİLSEL İFADE PROFİLİ/)
  assert.ok(!general.includes('Samimiyet/resmiyet:'))
})

test('blind pair output does not expose condition labels while key stores the mapping', () => {
  const pair = createBlindPair('case-01', 'general answer', 'styled answer', 'personalized')

  assert.deepEqual(pair.blind, {
    case_id: 'case-01',
    response_1: 'styled answer',
    response_2: 'general answer',
  })
  assert.deepEqual(pair.key, {
    case_id: 'case-01',
    response_1_condition: 'personalized',
    response_2_condition: 'baseline',
  })
  assert.ok(!Object.hasOwn(pair.blind, 'condition'))
})

test('blind pair rejects empty or invalid outputs', () => {
  assert.throws(() => createBlindPair('case-01', '', 'styled answer', 'baseline'))
  assert.throws(() => createBlindPair('case-01', 'general', 'styled', 'unknown'))
  assert.throws(() => buildProfile(['one']))
})

test('per-case seed is deterministic and shared between paired conditions', () => {
  const first = deriveCaseSeed('friendly-01', 42)
  assert.equal(deriveCaseSeed('friendly-01', 42), first)
  assert.notEqual(deriveCaseSeed('formal-01', 42), first)
  assert.throws(() => deriveCaseSeed('', 42))
  assert.throws(() => deriveCaseSeed('case-01', -1))
})

test('generation and presentation orders are randomized with balanced counts', () => {
  for (const count of [1, 2, 3, 30, 31]) {
    const order = createBalancedConditionOrder(count)
    assert.equal(order.length, count)
    assert.ok(order.every((condition) => ['baseline', 'personalized'].includes(condition)))
    const baselineCount = order.filter((condition) => condition === 'baseline').length
    const personalizedCount = order.filter((condition) => condition === 'personalized').length
    assert.ok(Math.abs(baselineCount - personalizedCount) <= 1)
  }

  assert.throws(() => createBalancedConditionOrder(0))
})

test('execution order is shuffled and condition order is balanced within each style profile', () => {
  const cases = [
    ...Array.from({ length: 5 }, (_, index) => ({ id: 'f-' + index, profile_id: 'friendly' })),
    ...Array.from({ length: 4 }, (_, index) => ({ id: 'r-' + index, profile_id: 'formal' })),
    ...Array.from({ length: 3 }, (_, index) => ({ id: 'c-' + index, profile_id: 'concise' })),
  ]
  const shuffled = shuffleCases(cases)
  assert.deepEqual(
    [...shuffled.map((item) => item.id)].sort(),
    [...cases.map((item) => item.id)].sort()
  )

  const order = createBalancedConditionOrderByProfile(shuffled)
  assert.equal(order.length, shuffled.length)
  for (const profileId of ['friendly', 'formal', 'concise']) {
    const conditions = order.filter((_, index) => shuffled[index].profile_id === profileId)
    const baseline = conditions.filter((value) => value === 'baseline').length
    const personalized = conditions.filter((value) => value === 'personalized').length
    assert.ok(Math.abs(baseline - personalized) <= 1)
  }

  assert.throws(() => createBalancedConditionOrderByProfile([]))
  assert.throws(() => createBalancedConditionOrderByProfile([{ profile_id: '' }]))
})
