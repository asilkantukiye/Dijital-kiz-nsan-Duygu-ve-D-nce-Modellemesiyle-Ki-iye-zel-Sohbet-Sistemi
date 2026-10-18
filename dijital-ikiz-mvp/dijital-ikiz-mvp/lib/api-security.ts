import { NextResponse } from 'next/server'
import { isAllowedOrigin } from '@/lib/origin-validation'

export { isAllowedOrigin } from '@/lib/origin-validation'

export function rejectCrossOrigin(request: Request) {
  if (isAllowedOrigin(request)) return null

  return NextResponse.json(
    { error: 'Geçersiz istek kaynağı.' },
    {
      status: 403,
      headers: { 'Cache-Control': 'no-store' }
    }
  )
}
