import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
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

  // Keep the SSR auth cookies fresh.
  await supabase.auth.getClaims()

  const pathname = request.nextUrl.pathname
  const protectedRoute =
    pathname === '/' ||
    pathname.startsWith('/api/chat') ||
    pathname.startsWith('/api/feedback') ||
    pathname.startsWith('/api/data')

  if (protectedRoute) {
    // getUser() performs a server-side Auth check, so a logged-out/stale
    // session cannot reach protected pages or APIs through the proxy.
    const {
      data: { user }
    } = await supabase.auth.getUser()

    if (!user) {
      if (pathname === '/') {
        const loginUrl = request.nextUrl.clone()
        loginUrl.pathname = '/login'
        loginUrl.search = ''
        return NextResponse.redirect(loginUrl)
      }

      return NextResponse.json(
        { error: 'Oturum bulunamadı.' },
        {
          status: 401,
          headers: { 'Cache-Control': 'private, no-store' }
        }
      )
    }
  }

  response.headers.set('Cache-Control', 'private, no-store')
  return response
}
