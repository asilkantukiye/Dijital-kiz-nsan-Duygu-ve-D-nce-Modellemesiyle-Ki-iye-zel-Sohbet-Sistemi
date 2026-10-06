import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: 'dijital-ikiz-insan',
    version: '0.2.0',
    configured: {
      supabase: Boolean(
        process.env.NEXT_PUBLIC_SUPABASE_URL &&
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
      ),
      huggingface: Boolean(process.env.HF_TOKEN)
    }
  })
}
