import { InferenceClient } from '@huggingface/inference'
import { withAbortTimeout } from './abort-timeout.js'
import { MEMORY_EMBEDDING_DIMENSION, validateEmbeddingVector } from './embedding-validation.ts'

const DEFAULT_EMBEDDING_MODEL = 'intfloat/multilingual-e5-small'
const EMBEDDING_TIMEOUT_MS = 15_000
const EMBEDDING_MAX_ATTEMPTS = 2

function backoffMs(attempt: number) {
  return attempt === 1 ? 350 : 700
}

function isNumericRow(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'number')
}

function poolTokenRows(value: unknown): number[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('Embedding token çıktısı boş veya geçersiz.')
  }

  const checkedRows = value.map((row) => {
    if (!isNumericRow(row) || row.length !== MEMORY_EMBEDDING_DIMENSION) {
      throw new Error('Embedding token boyutu beklenen 384 değer değil.')
    }
    if (row.some((item) => !Number.isFinite(item))) {
      throw new Error('Embedding token çıktısı geçersiz sayılar içeriyor.')
    }
    return row
  })

  // Incremental weighted mean avoids overflowing a large intermediate sum.
  const pooled = Array.from({ length: MEMORY_EMBEDDING_DIMENSION }, (_, column) => {
    let mean = 0
    for (let rowIndex = 0; rowIndex < checkedRows.length; rowIndex += 1) {
      const count = rowIndex + 1
      mean = mean * (rowIndex / count) + checkedRows[rowIndex][column] / count
      if (!Number.isFinite(mean)) {
        throw new Error('Embedding ortalaması geçersiz.')
      }
    }
    return mean
  })

  return validateEmbeddingVector(pooled)
}

/**
 * Accepts a sentence vector, a single-item batch vector, token rows, or a
 * single-item batch containing token rows. Multi-row 2D token output is pooled
 * rather than silently treating its first token as the sentence embedding.
 */
export function normalizeEmbeddingResponse(value: unknown): number[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('Embedding çıktısı boş veya geçersiz.')
  }

  if (isNumericRow(value)) {
    return validateEmbeddingVector(value)
  }

  if (value.every((row) => isNumericRow(row))) {
    // A one-row matrix is a batch-wrapped sentence embedding; multi-row
    // matrices are token-level output for this single input string.
    if (value.length === 1) return validateEmbeddingVector(value[0])
    return poolTokenRows(value)
  }

  // Some inference backends wrap token rows in a single batch dimension.
  if (value.length === 1 && Array.isArray(value[0])) {
    return poolTokenRows(value[0])
  }

  throw new Error('Embedding çıktısının türü veya şekli beklenen formatta değil.')
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

    if (typeof text !== 'string' || !text.trim()) throw new Error('Embedding metni boş.')
    if (kind !== 'query' && kind !== 'passage') throw new Error('Embedding türü geçersiz.')

    const input = `${kind}: ${text.trim().slice(0, 2000)}`
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

          return normalizeEmbeddingResponse(result)
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
