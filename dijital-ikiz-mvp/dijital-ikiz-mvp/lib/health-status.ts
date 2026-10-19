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
export function buildHealthStatus(environment: HealthEnvironment): HealthStatus {
  const supabase = Boolean(
    environment.supabaseUrl?.trim() &&
    environment.supabasePublishableKey?.trim()
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
