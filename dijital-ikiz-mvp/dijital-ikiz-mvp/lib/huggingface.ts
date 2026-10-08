import { InferenceClient } from '@huggingface/inference'

const EMBEDDING_DIMENSION = 384
const DEFAULT_EMBEDDING_MODEL = 'intfloat/multilingual-e5-small'
const EMBEDDING_TIMEOUT_MS = 15_000
const EMBEDDING_MAX_ATTEMPTS = 2

function backoffMs(attempt: number) {
  return attempt === 1 ? 350 : 700
}

function normalizeEmbedding(value: unknown): number[] {
  const rows = Array.isArray(value) && Array.isArray(value[0])
    ? value[0]
    : value

  if (!Array.isArray(rows) || rows.length !== EMBEDDING_DIMENSION) {
    throw new Error('Embedding boyutu beklenen 384 değer değil.')
  }

  const numbers = rows.map(Number)
  if (numbers.some((n) => !Number.isFinite(n))) {
    throw new Error('Embedding geçersiz sayılar içeriyor.')
  }

  const norm = Math.sqrt(numbers.reduce((sum, n) => sum + n * n, 0))
  if (!Number.isFinite(norm) || norm === 0) {
    throw new Error('Embedding normalize edilemedi.')
  }

  return numbers.map((n) => n / norm)
}

export interface EmbeddingProvider {
  embed(text: string, kind: 'query' | 'passage'): Promise<number[]>
}

export class HuggingFaceEmbeddingProvider implements EmbeddingProvider {
  private readonly model: string

  constructor(model = process.env.HF_EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL) {
    this.model = model
  }

  async embed(text: string, kind: 'query' | 'passage') {
    const token = process.env.HF_TOKEN
    if (!token) throw new Error('HF_TOKEN tanımlı değil.')

    const input = `${kind}: ${text.slice(0, 2000)}`
    let lastError: unknown = null

    for (let attempt = 1; attempt <= EMBEDDING_MAX_ATTEMPTS; attempt += 1) {
      try {
        const client = new InferenceClient(token)
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), EMBEDDING_TIMEOUT_MS)

        try {
          const result = await Promise.race([
            client.featureExtraction({
              model: this.model,
              inputs: input
            }),
            new Promise<never>((_, reject) => {
              setTimeout(() => reject(new Error('Embedding zaman aşımı.')), EMBEDDING_TIMEOUT_MS)
            })
          ])

          return normalizeEmbedding(result)
        } finally {
          clearTimeout(timeout)
          controller.abort()
        }
      } catch (error: unknown) {
        lastError = error
        if (attempt < EMBEDDING_MAX_ATTEMPTS) {
          await new Promise((resolve) => setTimeout(resolve, backoffMs(attempt)))
        }
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error('Embedding üretimi başarısız oldu.')
  }
}

export async function qwenChat(
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[]
) {
  const token = process.env.HF_TOKEN
  const model = process.env.HF_MODEL || 'Qwen/Qwen3-4B-Instruct-2507'

  if (!token) {
    throw new Error('HF_TOKEN tanımlı değil.')
  }

  let lastError: unknown = null

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    let res: Response

    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 30_000)

      try {
        res = await fetch('https://router.huggingface.co/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model,
            messages,
            temperature: 0.7,
            top_p: 0.8,
            max_tokens: 600,
            stream: false
          }),
          signal: controller.signal,
          cache: 'no-store'
        })
      } finally {
        clearTimeout(timeout)
      }
    } catch (error: unknown) {
      lastError = error instanceof Error && error.name === 'AbortError'
        ? new Error('Yapay zekâ yanıtı zaman aşımına uğradı. Lütfen tekrar deneyin.')
        : new Error('Hugging Face bağlantısı kurulamadı.')

      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, attempt === 1 ? 500 : 1000))
        continue
      }

      throw lastError
    }

    if (!res.ok) {
      const error =
        res.status === 401 || res.status === 403
          ? new Error('Hugging Face yetkilendirmesi başarısız.')
          : res.status === 429
            ? new Error('Hugging Face istek limiti aşıldı.')
            : res.status >= 500
              ? new Error('Hugging Face geçici olarak kullanılamıyor.')
              : new Error(`Hugging Face isteği reddetti (HTTP ${res.status}).`)

      if (attempt < 2 && (res.status === 408 || res.status === 429 || res.status >= 500)) {
        lastError = error
        await new Promise((resolve) => setTimeout(resolve, attempt === 1 ? 500 : 1000))
        continue
      }

      throw error
    }

    let data: any
    try {
      data = await res.json()
    } catch {
      throw new Error('Model yanıtı okunamadı.')
    }

    const reply = data?.choices?.[0]?.message?.content

    if (typeof reply !== 'string' || !reply.trim()) {
      throw new Error('Model geçerli bir yanıt döndürmedi.')
    }

    return reply.trim()
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Hugging Face isteği başarısız oldu.')
}
