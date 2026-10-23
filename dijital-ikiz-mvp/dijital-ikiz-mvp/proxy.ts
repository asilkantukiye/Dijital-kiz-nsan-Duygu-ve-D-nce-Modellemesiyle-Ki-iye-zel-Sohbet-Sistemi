import { NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase-proxy'
import { buildContentSecurityPolicy, createCspNonce } from '@/lib/csp'

export async function proxy(request: NextRequest) {
  // Avoid breaking the local Next.js development overlay. Production HTML gets
  // a unique CSP nonce per request; the policy is passed to Next in the request
  // headers so framework-generated inline scripts receive that nonce.
  if (process.env.NODE_ENV !== 'production') {
    return await updateSession(request)
  }

  const nonce = createCspNonce()
  const policy = buildContentSecurityPolicy(nonce, true)
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)
  requestHeaders.set('Content-Security-Policy', policy)

  const securedRequest = new NextRequest(request, { headers: requestHeaders })
  const response = await updateSession(securedRequest)
  response.headers.set('Content-Security-Policy', policy)
  return response
}

export const config = {
  matcher: [
    '/((?!api/health|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'
  ]
}
