import { randomBytes } from 'node:crypto'

/**
 * Return an unpredictable, per-request nonce. Never reuse it across responses.
 */
export function createCspNonce() {
  return randomBytes(18).toString('base64')
}

/**
 * Restrict browser resources to this origin and the Supabase endpoints used by
 * the client. Hugging Face and Upstash are server-to-server dependencies and
 * must not be exposed in browser connect-src.
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
    `style-src 'self' 'nonce-${nonce}'`,
    // Existing React/UI style attributes are still used; style elements need a nonce.
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
