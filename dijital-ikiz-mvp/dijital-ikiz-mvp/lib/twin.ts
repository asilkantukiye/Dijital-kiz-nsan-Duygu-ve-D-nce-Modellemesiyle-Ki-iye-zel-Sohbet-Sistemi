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

const clamp = (n: number) => Math.max(0, Math.min(1, n))

const defaultProfile: TwinProfile = {
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
}

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
    valence: clamp(0.5 + (positive ? 0.22 : 0) - (negative ? 0.22 : 0)),
    arousal: clamp(0.35 + (excited ? 0.35 : 0) + (emojiMatches.length > 0 ? 0.1 : 0)),
    dominance: clamp(0.5 + (informal ? 0.08 : 0)),
    openness: clamp(0.5 + (humor ? 0.12 : 0)),
    conscientiousness: clamp(0.5 + (text.length > 180 ? 0.08 : 0)),
    extraversion: clamp(0.5 + (emojiMatches.length > 0 ? 0.08 : 0) + (excited ? 0.08 : 0)),
    agreeableness: clamp(0.5 + (positive ? 0.08 : 0)),
    neuroticism: clamp(0.5 + (negative ? 0.16 : 0)),
    informality: clamp(informal ? 0.85 : 0.45),
    emoji_frequency: clamp(emojiMatches.length / Math.max(1, words.length)),
    humor: clamp(humor ? 0.85 : 0.35),
    slang: clamp(slang ? 0.85 : 0.25),
    avg_sentence_length: clamp(avgSentenceLength / 25)
  }

  const safePrevious = previous ? normalizeProfile(previous) : null
  if (!safePrevious) return current

  const alpha = 0.25

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