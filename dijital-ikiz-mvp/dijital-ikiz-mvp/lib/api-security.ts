import { NextResponse } from 'next/server'

/**
 * Determine whether a request's Origin is allowed by the current policy.
 * Missing Origin is allowed for non-browser/server-to-server clients; callers
 * must not interpret this function as a complete CSRF defense on its own.
 */
export function isAllowedOrigin(request: Request): boolean {
  const origin = request.headers.get('origin')

  // Non-browser/server-to-server clients may omit Origin.
  if (!origin) return true

  try {
    const requestOrigin = new URL(request.url).origin
    const originValue = new URL(origin).origin
    return originValue === requestOrigin
  } catch {
    // Treat malformed Origin values as untrusted.
    return false
  }
}

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
