const HF_TIMEOUT_MS = 45_000

export async function qwenChat(
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[]
) {
  const token = process.env.HF_TOKEN
  const model = process.env.HF_MODEL || 'Qwen/Qwen3-4B-Instruct-2507'

  if (!token) {
    throw new Error('HF_TOKEN tanımlı değil.')
  }

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
      throw new Error(`Hugging Face API hatası (${res.status}): ${detail.slice(0, 500)}`)
    }

    const data = await res.json()
    const reply = data?.choices?.[0]?.message?.content

    if (typeof reply !== 'string' || !reply.trim()) {
      throw new Error('Model geçerli bir yanıt döndürmedi.')
    }

    return reply.trim()
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Yapay zekâ yanıtı zaman aşımına uğradı. Lütfen tekrar deneyin.')
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}
