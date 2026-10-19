export type LimitedJsonResult =
  | { ok: true; value: unknown }
  | { ok: false; status: 400 | 413; error: string }

export async function readJsonBodyLimited(
  request: Request,
  maxBytes: number
): Promise<LimitedJsonResult> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new RangeError('maxBytes must be a positive safe integer.')
  }

  const declaredLength = request.headers.get('content-length')
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength)) {
      return { ok: false, status: 400, error: 'Geçersiz istek gövdesi.' }
    }

    const parsedLength = Number(declaredLength)
    if (!Number.isSafeInteger(parsedLength)) {
      return { ok: false, status: 400, error: 'Geçersiz istek gövdesi.' }
    }
    if (parsedLength > maxBytes) {
      return { ok: false, status: 413, error: 'İstek gövdesi izin verilen boyutu aşıyor.' }
    }
  }

  if (!request.body) {
    return { ok: false, status: 400, error: 'İstek gövdesi boş veya geçersiz.' }
  }

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue

      totalBytes += value.byteLength
      if (totalBytes > maxBytes) {
        try {
          await reader.cancel()
        } catch {
          // The size rejection remains authoritative if the client has disconnected.
        }
        return { ok: false, status: 413, error: 'İstek gövdesi izin verilen boyutu aşıyor.' }
      }

      chunks.push(value)
    }
  } catch {
    return { ok: false, status: 400, error: 'İstek gövdesi okunamadı.' }
  } finally {
    reader.releaseLock()
  }

  if (totalBytes === 0) {
    return { ok: false, status: 400, error: 'İstek gövdesi boş veya geçersiz.' }
  }

  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  let decoded: string
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return { ok: false, status: 400, error: 'İstek gövdesi geçerli UTF-8 değil.' }
  }

  try {
    return { ok: true, value: JSON.parse(decoded) as unknown }
  } catch {
    return { ok: false, status: 400, error: 'Geçersiz JSON gövdesi.' }
  }
}
