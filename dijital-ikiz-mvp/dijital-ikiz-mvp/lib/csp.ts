import { randomBytes } from 'node:crypto'

export type CspRequestContext = {
  nonce: string
  policy: string
}

function validServiceOrigin(value?: string) {
  if (!value?.trim()) return null

  try {
    const url = new URL(value.trim())
    if (!url.hostname || url.username || url.password || url.search || url.hash) return null

    if (url.protocol === 'https:') return url.origin
    if (
      url.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    ) {
      return url.origin
    }
    return null
  } catch {
    return null
  }
}

/**
 * Builds a fresh nonce-based CSP for a single dynamic request. The CSP header
 * is forwarded to Next.js so App Router can nonce its own inline bootstrap
 * scripts, and the same policy is added to the browser-facing response.
 */
export function createCspRequestContext(
  supabaseUrl?: string,
  nodeEnv = process.env.NODE_ENV
): CspRequestContext {
  const nonce = randomBytes(18).toString('base64')
  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "form-action 'self'",
    "script-src 'self' 'nonce-" + nonce + "' 'strict-dynamic'",
    "style-src 'self' 'nonce-" + nonce + "'",
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "manifest-src 'self'"
  ]

  const serviceOrigin = validServiceOrigin(supabaseUrl)
  const connectOrigins = new Set<string>(["'self'"])
  if (serviceOrigin) {
    connectOrigins.add(serviceOrigin)
    const parsed = new URL(serviceOrigin)
    parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:'
    connectOrigins.add(parsed.origin)
  }
  if (nodeEnv !== 'production') {
    connectOrigins.add('ws://localhost:3000')
    connectOrigins.add('ws://127.0.0.1:3000')
  }
  directives.push('connect-src ' + [...connectOrigins].join(' '))

  if (nodeEnv === 'production') directives.push('upgrade-insecure-requests')

  return {
    nonce,
    policy: directives.join('; ')
  }
}
