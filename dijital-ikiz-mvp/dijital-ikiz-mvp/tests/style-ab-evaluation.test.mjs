import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildProfile,
  buildSystemPrompt,
  createBlindPair,
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
