import { createHmac } from 'node:crypto'
import { isValidSupabaseUrl } from './supabase-url.ts'

const USER_LIMIT = 20
const GLOBAL_MINUTE_LIMIT = 120
const GLOBAL_DAY_LIMIT = 1000
const WINDOW_MS = 60_000
const DAY_TTL_MS = 48 * 60 * 60 * 1000
const REST_TIMEOUT_MS = 1_500
const MAX_LOCAL_KEYS = 10_000

type CounterReason = 'user' | 'global-minute' | 'global-day'
export type ChatRateLimitReason = CounterReason | 'allowed' | 'backend' | 'development-local'

export type ChatRateLimitDecision = {
  allowed: boolean
  unavailable: boolean
  retryAfterSeconds: number
  reason: ChatRateLimitReason
}

export type ChatRateLimitEnvironment = {
  NODE_ENV?: string
  UPSTASH_REDIS_REST_URL?: string
  UPSTASH_REDIS_REST_TOKEN?: string
  RATE_LIMIT_KEY_SALT?: string
  NEXT_PUBLIC_SUPABASE_URL?: string
  SUPABASE_SERVICE_ROLE_KEY?: string
}

type RateLimitOptions = {
  environment?: ChatRateLimitEnvironment
  fetcher?: typeof fetch
  now?: Date
  nowMs?: number
}

const localCounters = new Map<string, { count: number; resetAt: number }>()

// One EVAL runs atomically in Redis: checking and updating all three counters
// cannot interleave with another request. The {chat} hash tag keeps keys in
// the same Redis Cluster slot if the provider uses cluster routing.
const RATE_LIMIT_LUA = [
  'local function read_counter(key, ttl)',
  '  local count = tonumber(redis.call("GET", key) or "0")',
  '  local remaining = redis.call("PTTL", key)',
  '  if count > 0 and remaining < 0 then',
  '    redis.call("PEXPIRE", key, ttl)',
  '    remaining = ttl',
  '  end',
  '  return count, remaining',
  'end',
  'local user_count, user_ttl = read_counter(KEYS[1], tonumber(ARGV[2]))',
  'local minute_count, minute_ttl = read_counter(KEYS[2], tonumber(ARGV[2]))',
  'local day_count, day_ttl = read_counter(KEYS[3], tonumber(ARGV[5]))',
  'if user_count >= tonumber(ARGV[1]) then',
  '  return {0, math.max(user_ttl, 1000), "user"}',
  'end',
  'if minute_count >= tonumber(ARGV[3]) then',
  '  return {0, math.max(minute_ttl, 1000), "global-minute"}',
  'end',
  'if day_count >= tonumber(ARGV[4]) then',
  '  return {0, math.max(day_ttl, 1000), "global-day"}',
  'end',
  'local next_user = redis.call("INCR", KEYS[1])',
  'if next_user == 1 then redis.call("PEXPIRE", KEYS[1], tonumber(ARGV[2])) end',
  'local next_minute = redis.call("INCR", KEYS[2])',
  'if next_minute == 1 then redis.call("PEXPIRE", KEYS[2], tonumber(ARGV[2])) end',
  'local next_day = redis.call("INCR", KEYS[3])',
  'if next_day == 1 then redis.call("PEXPIRE", KEYS[3], tonumber(ARGV[5])) end',
  'return {1, 0, "allowed"}'
].join('\n')

function unavailable(): ChatRateLimitDecision {
  return {
    allowed: false,
    unavailable: true,
    retryAfterSeconds: 2,
    reason: 'backend'
  }
}

function localDevelopmentLimit(userId: string, nowMs: number): ChatRateLimitDecision {
  for (const [key, counter] of localCounters) {
    if (counter.resetAt <= nowMs) localCounters.delete(key)
  }

  while (localCounters.size >= MAX_LOCAL_KEYS) {
    const oldest = localCounters.keys().next().value
    if (!oldest) break
    localCounters.delete(oldest)
  }

  const counter = localCounters.get(userId)
  if (!counter || counter.resetAt <= nowMs) {
    localCounters.set(userId, { count: 1, resetAt: nowMs + WINDOW_MS })
    return {
      allowed: true,
      unavailable: false,
      retryAfterSeconds: 0,
      reason: 'development-local'
    }
  }

  if (counter.count >= USER_LIMIT) {
    return {
      allowed: false,
      unavailable: false,
      retryAfterSeconds: Math.max(1, Math.ceil((counter.resetAt - nowMs) / 1000)),
      reason: 'user'
    }
  }

  counter.count += 1
  return {
    allowed: true,
    unavailable: false,
    retryAfterSeconds: 0,
    reason: 'development-local'
  }
}

function validUpstashUrl(value?: string): URL | null {
  if (!value?.trim()) return null

  try {
    const url = new URL(value)
    if (
      url.protocol !== 'https:' ||
      !url.hostname.endsWith('.upstash.io') ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return null
    }
    return url
  } catch {
    return null
  }
}

/**
 * Production must have a distributed rate-limit store. A local Map is used
 * only when running explicitly outside production and no Upstash setting was
 * supplied. Missing/partial configuration or a backend error fails closed so
 * callers never spend on model inference without a valid limiter decision.
 */
export async function enforceChatRateLimit(
  userId: string,
  options: RateLimitOptions = {}
): Promise<ChatRateLimitDecision> {
  const environment = options.environment ?? process.env
  const now = options.now ?? new Date()
  const nowMs = options.nowMs ?? Date.now()
  const rawUrl = environment.UPSTASH_REDIS_REST_URL?.trim()
  const token = environment.UPSTASH_REDIS_REST_TOKEN?.trim()
  const salt = environment.RATE_LIMIT_KEY_SALT?.trim()
  const supabaseUrlValue = environment.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const supabaseServiceRoleKey = environment.SUPABASE_SERVICE_ROLE_KEY?.trim()
  const hasAnyConfiguration = Boolean(rawUrl || token || salt)

  if (!hasAnyConfiguration && environment.NODE_ENV !== 'production') {
    return localDevelopmentLimit(userId, nowMs)
  }

  if (!userId || !salt || salt.length < 32) return unavailable()

  const userDigest = createHmac('sha256', salt).update(userId).digest('hex')
  const url = validUpstashUrl(rawUrl)

  if (url && token) {
    const dayKey = now.toISOString().slice(0, 10)
  const keys = [
    'dijital-ikiz:{chat}:user:' + userDigest,
    'dijital-ikiz:{chat}:global:minute',
    'dijital-ikiz:{chat}:global:day:' + dayKey
  ]
  const command = [
    'EVAL',
    RATE_LIMIT_LUA,
    '3',
    ...keys,
    String(USER_LIMIT),
    String(WINDOW_MS),
    String(GLOBAL_MINUTE_LIMIT),
    String(GLOBAL_DAY_LIMIT),
    String(DAY_TTL_MS)
  ]

  try {
    const fetcher = options.fetcher ?? fetch
    const response = await fetcher(url, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(command),
      cache: 'no-store',
      signal: AbortSignal.timeout(REST_TIMEOUT_MS)
    })

    if (!response.ok) return unavailable()

    const payload: unknown = await response.json()
    if (!payload || typeof payload !== 'object' || !('result' in payload)) {
      return unavailable()
    }

    const result = (payload as { result?: unknown }).result
    if (!Array.isArray(result) || result.length < 3) return unavailable()

    const allowedValue = Number(result[0])
    const retryMs = Number(result[1])
    const reasonValue = result[2]

    if (
      (allowedValue !== 0 && allowedValue !== 1) ||
      !Number.isFinite(retryMs) ||
      retryMs < 0 ||
      typeof reasonValue !== 'string'
    ) {
      return unavailable()
    }

    if (allowedValue === 1 && reasonValue === 'allowed') {
      return {
        allowed: true,
        unavailable: false,
        retryAfterSeconds: 0,
        reason: 'allowed'
      }
    }

    if (
      allowedValue === 0 &&
      (reasonValue === 'user' || reasonValue === 'global-minute' || reasonValue === 'global-day')
    ) {
      return {
        allowed: false,
        unavailable: false,
        retryAfterSeconds: Math.max(1, Math.ceil(retryMs / 1000)),
        reason: reasonValue
      }
    }

    return unavailable()
  } catch {
    // Do not log endpoint credentials, provider payloads, or raw user IDs.
    return unavailable()
  }
  }

  // Production can use the existing Supabase database as an atomic distributed
  // limiter when Upstash is not provisioned. The RPC is service_role-only.
  if (
    isValidSupabaseUrl(supabaseUrlValue) &&
    supabaseServiceRoleKey &&
    userId
  ) {
    try {
      const fetcher = options.fetcher ?? fetch
      const response = await fetcher(
        new URL('/rest/v1/rpc/consume_chat_rate_limit', supabaseUrlValue!),
        {
          method: 'POST',
          headers: {
            apikey: supabaseServiceRoleKey,
            Authorization: 'Bearer ' + supabaseServiceRoleKey,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            p_user_digest: userDigest,
            p_now: now.toISOString()
          }),
          cache: 'no-store',
          redirect: 'error',
          signal: AbortSignal.timeout(REST_TIMEOUT_MS)
        }
      )

      if (!response.ok) return unavailable()

      const payload: unknown = await response.json()
      const row = Array.isArray(payload) ? payload[0] : payload
      if (!row || typeof row !== 'object') return unavailable()

      const result = row as {
        allowed?: unknown
        retry_after_seconds?: unknown
        reason?: unknown
      }
      const retryAfterSeconds = Number(result.retry_after_seconds)
      if (
        typeof result.allowed !== 'boolean' ||
        !Number.isInteger(retryAfterSeconds) ||
        retryAfterSeconds < 0 ||
        typeof result.reason !== 'string'
      ) {
        return unavailable()
      }

      if (result.allowed && result.reason === 'allowed' && retryAfterSeconds === 0) {
        return {
          allowed: true,
          unavailable: false,
          retryAfterSeconds: 0,
          reason: 'allowed'
        }
      }

      if (
        !result.allowed &&
        (result.reason === 'user' || result.reason === 'global-minute' || result.reason === 'global-day')
      ) {
        return {
          allowed: false,
          unavailable: false,
          retryAfterSeconds: Math.max(1, retryAfterSeconds),
          reason: result.reason
        }
      }

      return unavailable()
    } catch {
      // Do not log provider payloads, service keys, or raw user IDs.
      return unavailable()
    }
  }

  return unavailable()
}
