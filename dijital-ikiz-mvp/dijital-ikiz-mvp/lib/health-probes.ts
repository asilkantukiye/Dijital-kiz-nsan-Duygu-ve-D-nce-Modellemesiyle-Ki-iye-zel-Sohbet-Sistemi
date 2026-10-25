import { isValidSupabaseUrl } from './supabase-url.ts'

export type DeepHealthEnvironment = {
  supabaseUrl?: string
  supabasePublishableKey?: string
  huggingfaceToken?: string
  upstashRedisRestUrl?: string
  upstashRedisRestToken?: string
}

export type DeepHealthResult = {
  ok: boolean
  providers: {
    supabase: boolean
    huggingface: boolean
    rateLimit: boolean
  }
}

const PROBE_TIMEOUT_MS = 2_000

function validUpstashUrl(value?: string) {
  if (!value?.trim()) return null

  try {
    const url = new URL(value)
    if (
      url.protocol !== 'https:' ||
      !url.hostname.endsWith('.upstash.io') ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.pathname !== '/' && url.pathname !== '')
    ) {
      return null
    }

    return url
  } catch {
    return null
  }
}

async function probe(
  fetcher: typeof fetch,
  url: string | URL,
  init: RequestInit
) {
  try {
    const response = await fetcher(url, {
      ...init,
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
    })
    const successful = response.ok
    // These probes only need the status code. Release the connection without
    // returning response bodies or leaving unread provider data behind.
    try {
      await response.body?.cancel()
    } catch {
      // Cancellation failure must not change a completed HTTP status result.
    }
    return successful
  } catch {
    return false
  }
}

/**
 * Bounded network diagnostics for a manually authenticated smoke test.
 * Only boolean results leave this function; provider bodies and secrets never do.
 *
 * Hugging Face's whoami endpoint validates token authentication only. It does
 * not perform inference, incur an inference call, or guarantee model availability.
 */
export async function probeUpstreams(
  environment: DeepHealthEnvironment,
  fetcher: typeof fetch = fetch
): Promise<DeepHealthResult> {
  const supabaseUrl = isValidSupabaseUrl(environment.supabaseUrl)
    ? environment.supabaseUrl!.replace(/\/$/, '')
    : null
  const supabaseKey = environment.supabasePublishableKey?.trim()
  const hfToken = environment.huggingfaceToken?.trim()
  const redisUrl = validUpstashUrl(environment.upstashRedisRestUrl)
  const redisToken = environment.upstashRedisRestToken?.trim()

  const supabasePromise = supabaseUrl && supabaseKey
    ? probe(fetcher, new URL('/auth/v1/health', supabaseUrl), {
        method: 'GET',
        headers: { apikey: supabaseKey }
      })
    : Promise.resolve(false)

  const huggingfacePromise = hfToken
    ? probe(fetcher, 'https://huggingface.co/api/whoami-v2', {
        method: 'GET',
        headers: { Authorization: `Bearer ${hfToken}` }
      })
    : Promise.resolve(false)

  const rateLimitPromise = redisUrl && redisToken
    ? (async () => {
        try {
          const response = await fetcher(redisUrl, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${redisToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(['PING']),
            cache: 'no-store',
            redirect: 'error',
            signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
          })

          if (!response.ok) {
            try { await response.body?.cancel() } catch {}
            return false
          }

          let payload: unknown
          try {
            payload = await response.json()
          } catch {
            return false
          }

          return Boolean(
            payload &&
            typeof payload === 'object' &&
            'result' in payload &&
            (payload as { result?: unknown }).result === 'PONG'
          )
        } catch {
          return false
        }
      })()
    : Promise.resolve(false)

  const [supabase, huggingface, rateLimit] = await Promise.all([
    supabasePromise,
    huggingfacePromise,
    rateLimitPromise
  ])

  return {
    ok: supabase && huggingface && rateLimit,
    providers: { supabase, huggingface, rateLimit }
  }
}
