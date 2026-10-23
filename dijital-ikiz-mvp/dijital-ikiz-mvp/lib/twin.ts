export type TwinProfile = {
  valence: number
  arousal: number
  dominance: number
  openness: number
  conscientiousness: number
  extraversion: number
  agreeableness: number
  neuroticism: number
  informality: number
  emoji_frequency: number
  humor: number
  slang: number
  avg_sentence_length: number
}

// These are transparent, hand-authored experimental heuristics. They are not
// calibrated psychological measurements and must not be treated as diagnoses.
export const TWIN_MODEL_CALIBRATION_NOTE =
  'Uncalibrated heuristic; weights and neutral baselines require external validation.'

// Keep every baseline and coefficient named in one place so future calibration
// can be evidence-driven; do not imply these hand-selected values are learned.
export const TWIN_HEURISTIC_CONFIG = Object.freeze({
  baseline: Object.freeze({
    valence: 0.5,
    arousal: 0.35,
    dominance: 0.5,
    openness: 0.5,
    conscientiousness: 0.5,
    extraversion: 0.5,
    agreeableness: 0.5,
    neuroticism: 0.5,
    informality: 0.45,
    emoji_frequency: 0,
    humor: 0.35,
    slang: 0.25,
    avg_sentence_length: 0.2
  }),
  weights: Object.freeze({
    valencePolarity: 0.22,
    arousalExcitement: 0.35,
    arousalEmoji: 0.1,
    dominanceInformal: 0.08,
    opennessHumor: 0.12,
    conscientiousnessLongMessage: 0.08,
    extraversionEmoji: 0.08,
    extraversionExcitement: 0.08,
    agreeablenessPositive: 0.08,
    neuroticismNegative: 0.16,
    informalityDetected: 0.85,
    informalityNeutral: 0.45,
    humorDetected: 0.85,
    humorNeutral: 0.35,
    slangDetected: 0.85,
    slangNeutral: 0.25,
    avgSentenceLengthDivisor: 25
  }),
  smoothingAlpha: 0.25
})

const clamp = (n: number) => Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.5

const defaultProfile: TwinProfile = { ...TWIN_HEURISTIC_CONFIG.baseline }

export function normalizeProfile(input: unknown): TwinProfile {
  if (!input || typeof input !== 'object') return { ...defaultProfile }

  const source = input as Record<string, unknown>

  return (Object.keys(defaultProfile) as Array<keyof TwinProfile>).reduce((acc, key) => {
    const value = source[key]
    const safeValue =
      typeof value === 'number' && Number.isFinite(value)
        ? value
        : defaultProfile[key]

    acc[key] = clamp(safeValue)
    return acc
  }, {} as TwinProfile)
}

export function analyzeMessage(text: string, previous: TwinProfile | null): TwinProfile {
  const lower = text.toLocaleLowerCase('tr-TR')
  const emojiMatches = text.match(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu) ?? []
  const words = text.trim().split(/\s+/).filter(Boolean)
  const sentences = text.split(/[.!?]+/).filter(Boolean)
  const avgSentenceLength = words.length / Math.max(1, sentences.length)

  const informal = /(ya|abi|kanka|aga|lol|xd|şaka|valla|harbi|bence|çok|lan)\b/i.test(lower)
  const slang = /(abi|kanka|aga|lan|oğlum|olm|harbi|valla|yav|bro)\b/i.test(lower)
  const humor = /(😂|🤣|😅|haha|hahaha|şaka|komik|güldüm|lol|xd)/i.test(text)
  const positive = /(mutlu|harika|süper|seviyorum|güzel|iyi|başardım|teşekkür)/i.test(lower)
  const negative = /(üzgün|kötü|nefret|sinir|berbat|stres|korku|kaygı|yalnız)/i.test(lower)
  const excited = /!+/.test(text) || /(çok|aşırı|inanılmaz|müthiş)/i.test(lower)

  const current: TwinProfile = {
    valence: clamp(TWIN_HEURISTIC_CONFIG.baseline.valence + (positive ? TWIN_HEURISTIC_CONFIG.weights.valencePolarity : 0) - (negative ? TWIN_HEURISTIC_CONFIG.weights.valencePolarity : 0)),
    arousal: clamp(TWIN_HEURISTIC_CONFIG.baseline.arousal + (excited ? TWIN_HEURISTIC_CONFIG.weights.arousalExcitement : 0) + (emojiMatches.length > 0 ? TWIN_HEURISTIC_CONFIG.weights.arousalEmoji : 0)),
    dominance: clamp(TWIN_HEURISTIC_CONFIG.baseline.dominance + (informal ? TWIN_HEURISTIC_CONFIG.weights.dominanceInformal : 0)),
    openness: clamp(TWIN_HEURISTIC_CONFIG.baseline.openness + (humor ? TWIN_HEURISTIC_CONFIG.weights.opennessHumor : 0)),
    conscientiousness: clamp(TWIN_HEURISTIC_CONFIG.baseline.conscientiousness + (text.length > 180 ? TWIN_HEURISTIC_CONFIG.weights.conscientiousnessLongMessage : 0)),
    extraversion: clamp(TWIN_HEURISTIC_CONFIG.baseline.extraversion + (emojiMatches.length > 0 ? TWIN_HEURISTIC_CONFIG.weights.extraversionEmoji : 0) + (excited ? TWIN_HEURISTIC_CONFIG.weights.extraversionExcitement : 0)),
    agreeableness: clamp(TWIN_HEURISTIC_CONFIG.baseline.agreeableness + (positive ? TWIN_HEURISTIC_CONFIG.weights.agreeablenessPositive : 0)),
    neuroticism: clamp(TWIN_HEURISTIC_CONFIG.baseline.neuroticism + (negative ? TWIN_HEURISTIC_CONFIG.weights.neuroticismNegative : 0)),
    informality: clamp(informal ? TWIN_HEURISTIC_CONFIG.weights.informalityDetected : TWIN_HEURISTIC_CONFIG.weights.informalityNeutral),
    emoji_frequency: clamp(emojiMatches.length / Math.max(1, words.length)),
    humor: clamp(humor ? TWIN_HEURISTIC_CONFIG.weights.humorDetected : TWIN_HEURISTIC_CONFIG.weights.humorNeutral),
    slang: clamp(slang ? TWIN_HEURISTIC_CONFIG.weights.slangDetected : TWIN_HEURISTIC_CONFIG.weights.slangNeutral),
    avg_sentence_length: clamp(avgSentenceLength / TWIN_HEURISTIC_CONFIG.weights.avgSentenceLengthDivisor)
  }

  const safePrevious = previous ? normalizeProfile(previous) : null
  if (!safePrevious) return current

  const alpha = TWIN_HEURISTIC_CONFIG.smoothingAlpha

  return (Object.keys(current) as Array<keyof TwinProfile>).reduce((acc, key) => {
    acc[key] = safePrevious[key] * (1 - alpha) + current[key] * alpha
    return acc
  }, {} as TwinProfile)
}

export function profileToSystemPrompt(p: TwinProfile) {
  const profile = normalizeProfile(p)

  return `DİJİTAL İKİZ PROFİLİ (0-1 aralığı):
Duygu: valence=${profile.valence.toFixed(2)}, arousal=${profile.arousal.toFixed(2)}, dominance=${profile.dominance.toFixed(2)}
Big Five: openness=${profile.openness.toFixed(2)}, conscientiousness=${profile.conscientiousness.toFixed(2)}, extraversion=${profile.extraversion.toFixed(2)}, agreeableness=${profile.agreeableness.toFixed(2)}, neuroticism=${profile.neuroticism.toFixed(2)}
Üslup: informality=${profile.informality.toFixed(2)}, emoji=${profile.emoji_frequency.toFixed(2)}, humor=${profile.humor.toFixed(2)}, slang=${profile.slang.toFixed(2)}, sentence_length=${profile.avg_sentence_length.toFixed(2)}

Bu profil, kullanıcının yazım ve ifade eğilimlerini temsil eden deneysel bir modeldir. Yanıtı bu eğilimlere doğal biçimde yaklaştır; kullanıcının gerçek kimliğini taklit ettiğini, gerçek dünyada onun adına işlem yaptığını veya profesyonel/psikolojik tanı verdiğini iddia etme.`
}