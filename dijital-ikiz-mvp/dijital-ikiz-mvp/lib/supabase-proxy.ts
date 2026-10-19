import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })

  const pathname = request.nextUrl.pathname
  const protectedRoute =
    pathname === '/' ||
    pathname.startsWith('/api/chat') ||
    pathname.startsWith('/api/feedback') ||
    pathname.startsWith('/api/data')

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

  // Don't let a missing environment variable crash public pages before the
  // application can render its setup guidance. Protected routes stay closed.
  if (!supabaseUrl || !supabasePublishableKey) {
    if (protectedRoute) {
      return authUnavailableResponse(request, pathname)
    }

    response.headers.set('Cache-Control', 'private, no-store')
    return response
  }

  const supabase = createServerClient(
    supabaseUrl,
    supabasePublishableKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))

          response = NextResponse.next({ request })

          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options)
          })
        }
      }
    }
  )

  // Fail closed for protected routes if Supabase Auth cannot be reached, but
  // keep public pages such as /login available during a temporary auth outage.
  try {
    await supabase.auth.getClaims()
  } catch {
    if (protectedRoute) {
      return unauthenticatedResponse(request, pathname)
    }

    response.headers.set('Cache-Control', 'private, no-store')
    return response
  }

  if (protectedRoute) {
    // getUser() performs a server-side Auth check, so a logged-out/stale
    // session cannot reach protected pages or APIs through the proxy.
    let hasAuthenticatedUser = false
    try {
      const {
        data: { user }
      } = await supabase.auth.getUser()
      hasAuthenticatedUser = Boolean(user)
    } catch {
      // A network/auth provider exception must never bypass this guard.
      return unauthenticatedResponse(request, pathname)
    }

    if (!hasAuthenticatedUser) {
      return unauthenticatedResponse(request, pathname)
    }
  }

  response.headers.set('Cache-Control', 'private, no-store')
  return response
}

function loginRedirect(request: NextRequest) {
  const loginUrl = request.nextUrl.clone()
  loginUrl.pathname = '/login'
  loginUrl.search = ''
  const redirect = NextResponse.redirect(loginUrl)
  redirect.headers.set('Cache-Control', 'private, no-store')
  return redirect
}

function unauthenticatedResponse(request: NextRequest, pathname: string) {
  if (pathname === '/') return loginRedirect(request)

  return NextResponse.json(
    { error: 'Oturum bulunamadı.' },
    {
      status: 401,
      headers: { 'Cache-Control': 'private, no-store' }
    }
  )
}

function authUnavailableResponse(request: NextRequest, pathname: string) {
  if (pathname === '/') return loginRedirect(request)

  return NextResponse.json(
    { error: 'Kimlik doğrulama hizmeti yapılandırılmamış.' },
    {
      status: 503,
      headers: { 'Cache-Control': 'private, no-store' }
    }
  )
}
