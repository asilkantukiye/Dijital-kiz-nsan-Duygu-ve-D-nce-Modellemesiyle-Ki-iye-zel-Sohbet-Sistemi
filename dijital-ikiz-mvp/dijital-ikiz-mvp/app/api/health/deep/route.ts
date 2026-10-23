import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { probeUpstreams } from '@/lib/health-probes'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function isAuthorized(request: Request) {
  const configured = process.env.HEALTHCHECK_TOKEN
  const supplied = request.headers.get('x-healthcheck-token')

  if (!configured || configured.length < 32 || !supplied) return false

  const expectedBytes = Buffer.from(configured, 'utf8')
  const suppliedBytes = Buffer.from(supplied, 'utf8')
  if (expectedBytes.length !== suppliedBytes.length) return false

  return timingSafeEqual(expectedBytes, suppliedBytes)
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    // Do not reveal whether the route or its secret is configured.
    return new NextResponse(null, {
      status: 404,
      headers: { 'Cache-Control': 'no-store' }
    })
  }

  const result = await probeUpstreams({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    supabasePublishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    huggingfaceToken: process.env.HF_TOKEN,
    upstashRedisRestUrl: process.env.UPSTASH_REDIS_REST_URL,
    upstashRedisRestToken: process.env.UPSTASH_REDIS_REST_TOKEN
  })

  return NextResponse.json(result, {
    status: result.ok ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' }
  })
}
