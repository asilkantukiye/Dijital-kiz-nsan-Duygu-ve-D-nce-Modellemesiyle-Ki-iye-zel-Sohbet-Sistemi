import { type NextRequest } from 'next/server'
import { createCspRequestContext } from '@/lib/csp'
import { updateSession } from '@/lib/supabase-proxy'

export async function proxy(request: NextRequest) {
  const context = createCspRequestContext(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NODE_ENV
  )
  const response = await updateSession(request, context)

  // Add the same per-request policy to every response path, including auth
  // redirects and JSON denials. Request-side policy/nonce are forwarded by
  // updateSession so Next.js can attach the nonce to inline bootstrap scripts.
  response.headers.set('Content-Security-Policy', context.policy)
  return response
}

export const config = {
  matcher: [
    '/((?!api/health/?$|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'
  ]
}
