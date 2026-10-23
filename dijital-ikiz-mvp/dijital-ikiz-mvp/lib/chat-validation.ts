export type ChatVariant = 'personalized' | 'baseline'

export type ChatPayload = {
  message: string
  variant: ChatVariant
}

export type ChatPayloadValidation =
  | { ok: true; value: ChatPayload }
  | { ok: false; error: string; status: 400 | 413 }

export const MAX_CHAT_MESSAGE_LENGTH = 4000

export function sanitizeChatText(value: unknown): string {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
}

export function validateChatPayload(input: unknown): ChatPayloadValidation {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'Geçersiz sohbet isteği.', status: 400 }
  }

  const body = input as Record<string, unknown>
  const allowedKeys = new Set(['message', 'variant'])
  if (Object.keys(body).some((key) => !allowedKeys.has(key))) {
    return { ok: false, error: 'İstek yalnızca mesaj ve varyant içerebilir.', status: 400 }
  }

  if (body.variant !== 'personalized' && body.variant !== 'baseline') {
    return { ok: false, error: 'Geçersiz deney varyantı.', status: 400 }
  }

  if (typeof body.message !== 'string') {
    return { ok: false, error: 'Mesaj metin olmalıdır.', status: 400 }
  }

  const message = sanitizeChatText(body.message)
  if (!message) {
    return { ok: false, error: 'Mesaj boş.', status: 400 }
  }

  if (message.length > MAX_CHAT_MESSAGE_LENGTH) {
    return {
      ok: false,
      error: 'Mesaj en fazla 4000 karakter olabilir.',
      status: 413
    }
  }

  return { ok: true, value: { message, variant: body.variant } }
}
