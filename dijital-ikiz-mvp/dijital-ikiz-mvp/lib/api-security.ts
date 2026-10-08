import { NextResponse } from 'next/server'

export function rejectCrossOrigin(request: Request) {
  const origin = request.headers.get('origin')

  // Non-browser/server-to-server clients may omit Origin. Cookie-authenticated
  // browser requests with an Origin header must come from the same origin.
  if (!origin) return null

  try {
    const requestOrigin = new URL(request.url).origin
    const originValue = new URL(origin).origin

    if (originValue === requestOrigin) return null
  } catch {
    // Treat malformed Origin values as untrusted.
  }

  return NextResponse.json(
    { error: 'Geçersiz istek kaynağı.' },
    {
      status: 403,
      headers: { 'Cache-Control': 'no-store' }
    }
  )
}
