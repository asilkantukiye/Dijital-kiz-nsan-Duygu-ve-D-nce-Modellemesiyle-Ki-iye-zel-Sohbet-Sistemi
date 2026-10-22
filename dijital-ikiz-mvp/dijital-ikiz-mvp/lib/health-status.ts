import { isValidSupabaseUrl } from './supabase-url.ts'

export type HealthEnvironment = {
  supabaseUrl?: string
  supabasePublishableKey?: string
  huggingfaceToken?: string
  upstashRedisRestUrl?: string
  upstashRedisRestToken?: string
  rateLimitKeySalt?: string
  nodeEnv?: string
}

export type HealthStatus = {
  ok: true
  ready: boolean
  service: 'dijital-ikiz-insan'
  version: '0.3.0'
  configured: {
    supabase: boolean
    huggingface: boolean
    rateLimit: boolean
  }
}

/**
 * Separate liveness from readiness.
 *
 * `ok` means the health endpoint can respond. `ready` means the minimum
 * server-side configuration for chat is present. This intentionally does not
 * make network requests to providers or reveal credential values.
 */
function isValidUpstashRestUrl(value?: string) {
  if (!value?.trim()) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' &&
      url.hostname.endsWith('.upstash.io') &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
  } catch {
    return false
  }
}

export function buildHealthStatus(environment: HealthEnvironment): HealthStatus {
  const supabase = Boolean(
    isValidSupabaseUrl(environment.supabaseUrl) &&
    environment.supabasePublishableKey?.trim()
  )
  const huggingface = Boolean(environment.huggingfaceToken?.trim())
  const rateLimit = Boolean(
    isValidUpstashRestUrl(environment.upstashRedisRestUrl) &&
    environment.upstashRedisRestToken?.trim() &&
    (environment.rateLimitKeySalt?.trim().length ?? 0) >= 32
  )

  return {
    ok: true,
    // In production, without a distributed limiter the chat route fails closed.
    ready: supabase && huggingface && (environment.nodeEnv !== 'production' || rateLimit),
    service: 'dijital-ikiz-insan',
    version: '0.3.0',
    configured: {
      supabase,
      huggingface,
      rateLimit
    }
  }
}
