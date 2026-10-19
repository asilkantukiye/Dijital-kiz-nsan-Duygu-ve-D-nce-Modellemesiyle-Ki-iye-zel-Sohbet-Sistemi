import { InferenceClient } from '@huggingface/inference'
import { withAbortTimeout } from './abort-timeout'

const EMBEDDING_DIMENSION = 384
const DEFAULT_EMBEDDING_MODEL = 'intfloat/multilingual-e5-small'
const EMBEDDING_TIMEOUT_MS = 15_000
const EMBEDDING_MAX_ATTEMPTS = 2

function backoffMs(attempt: number) {
  return attempt === 1 ? 350 : 700
}

function normalizeEmbedding(value: unknown): number[] {
  const source = Array.isArray(value) ? value : []
  let rows: unknown = source

  if (Array.isArray(source[0]) && Array.isArray(source[0][0])) {
    const tokenRows = source[0] as unknown[]
    const usable = tokenRows.filter((row): row is unknown[] => Array.isArray(row))
    if (usable.length === 0) {
      throw new Error('Embedding çıktısı boş.')
    }

    const pooled = Array.from({ length: EMBEDDING_DIMENSION }, (_, index) => {
      const values = usable.map((row) => Number(row[index])).filter(Number.isFinite)
      return values.length > 0
        ? values.reduce((sum, item) => sum + item, 0) / values.length
        : 0
    })
    rows = pooled
  } else if (Array.isArray(source[0])) {
    rows = source[0]
  }

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
          const result = await client.featureExtraction(
            {
              model: this.model,
              inputs: input
            },
            {
              signal: controller.signal,
              retry_on_error: false
            }
          )

          return normalizeEmbedding(result)
        } finally {
          clearTimeout(timeout)
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
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  timeoutMs = 30_000
) {
  const token = process.env.HF_TOKEN
  const model = process.env.HF_MODEL || 'Qwen/Qwen3-4B-Instruct-2507'
  const timeoutMessage = 'Yapay zekâ yanıtı zaman aşımına uğradı. Lütfen tekrar deneyin.'

  if (!token) {
    throw new Error('HF_TOKEN tanımlı değil.')
  }

  let lastError: unknown = null

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    let completion: { response: Response; data?: unknown }

    try {
      completion = await withAbortTimeout(
        timeoutMs,
        async (signal) => {
          const response = await fetch('https://router.huggingface.co/v1/chat/completions', {
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
            signal,
            cache: 'no-store'
          })

          if (!response.ok) {
            return { response }
          }

          let data: unknown
          try {
            // Keep the same abort signal active while the response body is read.
            // Fetch resolving headers does not mean response.json() has completed.
            data = await response.json()
          } catch {
            throw new Error('Model yanıtı okunamadı.')
          }

          return { response, data }
        },
        timeoutMessage
      )
    } catch (error: unknown) {
      if (error instanceof Error && error.message === 'Model yanıtı okunamadı.') {
        throw error
      }

      lastError = error instanceof Error && error.message === timeoutMessage
        ? error
        : new Error('Hugging Face bağlantısı kurulamadı.')

      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, attempt === 1 ? 500 : 1000))
        continue
      }

      throw lastError
    }

    const { response: res, data } = completion

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

    const parsed = data as {
      choices?: Array<{ message?: { content?: unknown } }>
    } | undefined
    const reply = parsed?.choices?.[0]?.message?.content

    if (typeof reply !== 'string' || !reply.trim()) {
      throw new Error('Model geçerli bir yanıt döndürmedi.')
    }

    return reply.trim()
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Hugging Face isteği başarısız oldu.')
}
