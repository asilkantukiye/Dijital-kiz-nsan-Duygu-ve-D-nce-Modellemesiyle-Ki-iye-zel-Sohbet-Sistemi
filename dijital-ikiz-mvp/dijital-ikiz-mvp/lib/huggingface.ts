const HF_TIMEOUT_MS = 30_000
const HF_MAX_ATTEMPTS = 2

function isRetryableStatus(status: number) {
  return status === 408 || status === 429 || status >= 500
}

function backoffMs(attempt: number) {
  return attempt === 1 ? 500 : 1000
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError'
}

function providerErrorMessage(status: number) {
  if (status === 401 || status === 403) {
    return 'Hugging Face yetkilendirmesi başarısız.'
  }

  if (status === 429) {
    return 'Hugging Face istek limiti aşıldı.'
  }

  if (status >= 500) {
    return 'Hugging Face geçici olarak kullanılamıyor.'
  }

  return `Hugging Face isteği reddetti (HTTP ${status}).`
}

async function fetchHuggingFace(
  token: string,
  model: string,
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[]
) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), HF_TIMEOUT_MS)

  try {
    return await fetch('https://router.huggingface.co/v1/chat/completions', {
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
    let res: Response

    try {
      res = await fetchHuggingFace(token, model, messages)
    } catch (error: unknown) {
      if (!isAbortError(error)) {
        lastError = new Error('Hugging Face bağlantısı kurulamadı.')
      } else {
        lastError = new Error('Yapay zekâ yanıtı zaman aşımına uğradı. Lütfen tekrar deneyin.')
      }

      if (attempt < HF_MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, backoffMs(attempt)))
        continue
      }

      throw lastError
    }

    if (!res.ok) {
      const error = new Error(providerErrorMessage(res.status))

      if (attempt < HF_MAX_ATTEMPTS && isRetryableStatus(res.status)) {
        lastError = error
        await new Promise((resolve) => setTimeout(resolve, backoffMs(attempt)))
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
