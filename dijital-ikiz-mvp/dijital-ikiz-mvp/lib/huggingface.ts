const HF_TIMEOUT_MS = 30_000
const HF_MAX_ATTEMPTS = 2

function isRetryableStatus(status: number) {
  return status === 408 || status === 429 || status >= 500
}

function backoffMs(attempt: number) {
  return attempt === 1 ? 500 : 1000
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

  for (let attempt = 1; attempt <= HF_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), HF_TIMEOUT_MS)

    try {
      const res = await fetch('https://router.huggingface.co/v1/chat/completions', {
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
          max_tokens: 700,
          stream: false
        }),
        signal: controller.signal,
        cache: 'no-store'
      })

      if (!res.ok) {
        const detail = await res.text()
        const error = new Error(
          `Hugging Face API hatası (${res.status}): ${detail.slice(0, 500)}`
        )

        if (attempt < HF_MAX_ATTEMPTS && isRetryableStatus(res.status)) {
          lastError = error
          await new Promise((resolve) => setTimeout(resolve, backoffMs(attempt)))
          continue
        }

        throw error
      }

      const data = await res.json()
      const reply = data?.choices?.[0]?.message?.content

      if (typeof reply !== 'string' || !reply.trim()) {
        throw new Error('Model geçerli bir yanıt döndürmedi.')
      }

      return reply.trim()
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        lastError = new Error('Yapay zekâ yanıtı zaman aşımına uğradı. Lütfen tekrar deneyin.')
        if (attempt < HF_MAX_ATTEMPTS) {
          await new Promise((resolve) => setTimeout(resolve, backoffMs(attempt)))
          continue
        }
      } else {
        lastError = error
      }

      if (attempt < HF_MAX_ATTEMPTS && !(error instanceof DOMException && error.name === 'AbortError')) {
        // Network errors are transient candidates; retry once without exposing
        // provider internals to the caller.
        await new Promise((resolve) => setTimeout(resolve, backoffMs(attempt)))
        continue
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Hugging Face isteği başarısız oldu.')
}
