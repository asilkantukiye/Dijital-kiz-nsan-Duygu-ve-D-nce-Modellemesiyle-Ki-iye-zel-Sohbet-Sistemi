/**
 * Accept HTTPS Supabase endpoints and local HTTP URLs used during development.
 * Reject malformed URLs, non-HTTP protocols, embedded credentials and URL
 * parameters that can make client construction fail or target an unintended URL.
 */
export function isValidSupabaseUrl(value?: string | null): boolean {
  if (!value?.trim()) return false

  try {
    const url = new URL(value.trim())

    if (!url.hostname || url.username || url.password || url.search || url.hash) {
      return false
    }

    if (url.protocol === 'https:') return true

    // Local Supabase development commonly serves HTTP on loopback only.
    if (url.protocol === 'http:') {
      return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    }

    return false
  } catch {
    return false
  }
}
