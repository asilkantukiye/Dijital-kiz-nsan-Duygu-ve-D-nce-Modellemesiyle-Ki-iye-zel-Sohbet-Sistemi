import { type NextRequest } from 'next/server'
import { buildContentSecurityPolicy, createCspNonce } from '@/lib/csp'
import { updateSession } from '@/lib/supabase-proxy'

export async function proxy(request: NextRequest) {
  // Keep the local development overlay working. Production responses get a
  // unique nonce, forwarded in the request CSP so Next can nonce its own scripts.
  if (process.env.NODE_ENV !== 'production') {
    return await updateSession(request)
  }

  const nonce = createCspNonce()
  const policy = buildContentSecurityPolicy(nonce, true)
  const requestHeaderOverrides = new Headers({
    'x-nonce': nonce,
    'Content-Security-Policy': policy
  })

  const response = await updateSession(request, requestHeaderOverrides)
  response.headers.set('Content-Security-Policy', policy)
  return response
}

export const config = {
  matcher: [
    '/((?!api/health|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'
  ]
}
