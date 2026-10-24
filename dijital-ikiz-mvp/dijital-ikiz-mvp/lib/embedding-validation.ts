export const MEMORY_EMBEDDING_DIMENSION = 384

/**
 * Validate vectors at the application boundary before pgvector RPC/INSERT/UPDATE.
 * Only numeric finite values are accepted; coercing strings/null would hide
 * provider shape drift. Return a unit-normalized vector because storage and
 * cosine retrieval both assume a valid non-zero embedding.
 */
export function validateEmbeddingVector(value: unknown): number[] {
  if (!Array.isArray(value) || value.length !== MEMORY_EMBEDDING_DIMENSION) {
    throw new Error('Embedding dimension must be exactly ' + MEMORY_EMBEDDING_DIMENSION + '.')
  }

  const vector: number[] = []
  let scale = 0
  let sumSquares = 1

  for (const item of value) {
    if (typeof item !== 'number' || !Number.isFinite(item)) {
      throw new Error('Embedding must contain only finite numbers.')
    }

    vector.push(item)
    const magnitude = Math.abs(item)
    if (magnitude === 0) continue

    if (scale < magnitude) {
      sumSquares = 1 + sumSquares * (scale / magnitude) ** 2
      scale = magnitude
    } else {
      sumSquares += (magnitude / scale) ** 2
    }
  }

  if (scale === 0) throw new Error('Embedding must not be an all-zero vector.')

  const norm = scale * Math.sqrt(sumSquares)
  if (!Number.isFinite(norm) || norm <= 0) {
    throw new Error('Embedding norm must be finite and greater than zero.')
  }

  const normalized = vector.map((item) => item / norm)
  if (normalized.some((item) => !Number.isFinite(item))) {
    throw new Error('Embedding normalization produced a non-finite value.')
  }

  return normalized
}
