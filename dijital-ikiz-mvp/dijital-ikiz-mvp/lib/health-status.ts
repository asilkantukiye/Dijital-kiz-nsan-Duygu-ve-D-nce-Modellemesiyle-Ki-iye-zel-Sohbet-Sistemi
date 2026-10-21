import { isValidSupabaseUrl } from './supabase-url.ts'

export type HealthEnvironment = {
  supabaseUrl?: string
  supabasePublishableKey?: string
  huggingfaceToken?: string
}

export type HealthStatus = {
  ok: true
  ready: boolean
  service: 'dijital-ikiz-insan'
  version: '0.3.0'
  configured: {
    supabase: boolean
    huggingface: boolean
  }
}

/**
 * Separate liveness from readiness.
 *
 * `ok` means the health endpoint can respond. `ready` means the minimum
 * server-side configuration for chat is present. This intentionally does not
 * make network requests to providers or reveal credential values.
 */
function isValidSupabasePublishableKey(value?: string) {
  const key = value?.trim()
  if (!key) return false

  // Supabase currently issues opaque publishable keys. Continue accepting
  // legacy anon JWTs while existing projects migrate to the new key format.
  return (
    /^sb_publishable_[A-Za-z0-9_-]{22}_[A-Za-z0-9_-]{8}$/.test(key) ||
    /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)
  )
}

export function buildHealthStatus(environment: HealthEnvironment): HealthStatus {
  const supabase = Boolean(
    isValidSupabaseUrl(environment.supabaseUrl) &&
    isValidSupabasePublishableKey(environment.supabasePublishableKey)
  )
  const huggingface = Boolean(environment.huggingfaceToken?.trim())

  return {
    ok: true,
    ready: supabase && huggingface,
    service: 'dijital-ikiz-insan',
    version: '0.3.0',
    configured: {
      supabase,
      huggingface
    }
  }
}
