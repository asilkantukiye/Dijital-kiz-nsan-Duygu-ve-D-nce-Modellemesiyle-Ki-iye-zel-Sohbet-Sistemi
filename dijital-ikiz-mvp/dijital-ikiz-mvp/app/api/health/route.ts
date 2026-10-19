import { NextResponse } from 'next/server'
import { buildHealthStatus } from '@/lib/health-status'

export async function GET() {
  const status = buildHealthStatus({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    supabasePublishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    huggingfaceToken: process.env.HF_TOKEN
  })

  // HTTP 200 means the process is alive; clients should inspect `ready`
  // to determine whether the minimum chat-provider configuration is present.
  return NextResponse.json(status, {
    headers: { 'Cache-Control': 'no-store' }
  })
}
