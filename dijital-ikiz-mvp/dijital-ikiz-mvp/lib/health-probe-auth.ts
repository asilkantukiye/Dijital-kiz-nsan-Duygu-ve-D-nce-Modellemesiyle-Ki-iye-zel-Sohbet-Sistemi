import { timingSafeEqual } from 'node:crypto'

const MIN_HEALTHCHECK_TOKEN_LENGTH = 32

/**
 * The deep health route is an operational endpoint, not a public status API.
 * Compare equal-length byte buffers in constant time and fail closed when
 * either token is missing or the configured secret is too short.
 */
export function isAuthorizedHealthcheck(configured?: string, supplied?: string | null) {
  if (
    !configured ||
    configured.length < MIN_HEALTHCHECK_TOKEN_LENGTH ||
    !supplied
  ) {
    return false
  }

  const expectedBytes = Buffer.from(configured, 'utf8')
  const suppliedBytes = Buffer.from(supplied, 'utf8')
  if (expectedBytes.length !== suppliedBytes.length) return false

  return timingSafeEqual(expectedBytes, suppliedBytes)
}
