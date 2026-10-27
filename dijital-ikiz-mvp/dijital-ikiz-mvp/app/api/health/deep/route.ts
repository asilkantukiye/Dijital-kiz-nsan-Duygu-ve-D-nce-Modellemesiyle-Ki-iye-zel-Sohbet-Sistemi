import { NextResponse } from 'next/server'
import { isAuthorizedHealthcheck } from '@/lib/health-probe-auth'
import { probeUpstreams } from '@/lib/health-probes'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  if (!isAuthorizedHealthcheck(
    process.env.HEALTHCHECK_TOKEN,
    request.headers.get('x-healthcheck-token')
  )) {
    // Do not reveal whether the route or its secret is configured.
    return new NextResponse(null, {
      status: 404,
      headers: { 'Cache-Control': 'no-store' }
    })
  }

  const result = await probeUpstreams({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    supabasePublishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    huggingfaceToken: process.env.HF_TOKEN,
    upstashRedisRestUrl: process.env.UPSTASH_REDIS_REST_URL,
    upstashRedisRestToken: process.env.UPSTASH_REDIS_REST_TOKEN
  })

  return NextResponse.json(result, {
    status: result.ok ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' }
  })
}
