import { randomBytes } from 'node:crypto'

/**
 * Generate a fresh per-request nonce. Base64 encodes random bytes into a CSP-safe value.
 * The nonce must never be reused across requests or written to persistent logs.
 */
export function createCspNonce() {
  return randomBytes(18).toString('base64')
}

/**
 * Browser CSP is deliberately least-privilege:
 * - Supabase HTTPS + Realtime WebSocket are the only external browser connections.
 * - Hugging Face inference and Upstash are server-to-server and MUST NOT be exposed
 *   as browser connect-src dependencies (doing so is unnecessary and widens XSS egress).
 * - Inline script execution is nonce-gated; unsafe-eval is never enabled in production.
 */
export function buildContentSecurityPolicy(nonce: string, production = true) {
  if (!/^[A-Za-z0-9+/=_-]+$/.test(nonce)) {
    throw new Error('Invalid CSP nonce.')
  }

  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    // Nonce style elements; permit only current React style attributes separately.
    // Removing those attributes can later let style-src-attr become self-only.
    `style-src 'self' 'nonce-${nonce}'`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "manifest-src 'self'",
    "worker-src 'self' blob:",
    "media-src 'self'",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co"
  ]

  if (production) directives.push('upgrade-insecure-requests')
  return directives.join('; ')
}
