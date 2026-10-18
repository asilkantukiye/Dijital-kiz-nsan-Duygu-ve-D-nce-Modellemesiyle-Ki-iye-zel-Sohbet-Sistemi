export type FeedbackVariant = 'personalized' | 'baseline'

export type FeedbackPayload = {
  messageId: string
  rating: number
  comment: string | null
  variant: FeedbackVariant
}

export type FeedbackPayloadValidation =
  | { ok: true; value: FeedbackPayload }
  | { ok: false; error: string }

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_COMMENT_LENGTH = 1000

export function validateFeedbackPayload(input: unknown): FeedbackPayloadValidation {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'Geçersiz geri bildirim gövdesi.' }
  }

  const body = input as Record<string, unknown>
  const messageId =
    typeof body.messageId === 'string' ? body.messageId.trim() : ''

  if (!messageId) {
    return { ok: false, error: 'Mesaj kimliği gerekli.' }
  }

  if (!UUID_PATTERN.test(messageId)) {
    return { ok: false, error: 'Geçersiz mesaj kimliği.' }
  }

  // Do not coerce strings, booleans, null, or arrays into numeric ratings.
  if (
    typeof body.rating !== 'number' ||
    !Number.isInteger(body.rating) ||
    body.rating < 1 ||
    body.rating > 5
  ) {
    return { ok: false, error: 'Puan 1 ile 5 arasında tam sayı olmalıdır.' }
  }

  if (body.variant !== 'personalized' && body.variant !== 'baseline') {
    return { ok: false, error: 'Geçersiz deney varyantı.' }
  }

  let comment: string | null = null
  if (body.comment !== undefined && body.comment !== null) {
    if (typeof body.comment !== 'string') {
      return { ok: false, error: 'Yorum metin olmalıdır.' }
    }

    if (body.comment.length > MAX_COMMENT_LENGTH) {
      return {
        ok: false,
        error: 'Yorum en fazla 1000 karakter olabilir.'
      }
    }

    comment = body.comment.trim() || null
  }

  return {
    ok: true,
    value: {
      messageId,
      rating: body.rating,
      comment,
      variant: body.variant
    }
  }
}
