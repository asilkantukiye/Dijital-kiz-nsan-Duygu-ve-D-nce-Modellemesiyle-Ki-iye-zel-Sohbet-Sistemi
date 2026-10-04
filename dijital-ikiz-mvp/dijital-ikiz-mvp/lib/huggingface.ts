export async function qwenChat(messages: { role: 'system' | 'user' | 'assistant'; content: string }[]) {
  const token = process.env.HF_TOKEN
  const model = process.env.HF_MODEL || 'Qwen/Qwen3-4B-Instruct-2507'
  if (!token) throw new Error('HF_TOKEN tanımlı değil.')

  const res = await fetch('https://router.huggingface.co/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.7,
      top_p: 0.8,
      max_tokens: 700,
      stream: false
    })
  })

  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`Hugging Face API hatası (${res.status}): ${detail}`)
  }
  const data = await res.json()
  return data.choices?.[0]?.message?.content ?? 'Yanıt üretilemedi.'
}
