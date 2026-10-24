import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { isValidSupabaseUrl } from './supabase-url'

export async function createClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if (typeof supabaseUrl !== 'string' || !isValidSupabaseUrl(supabaseUrl) || typeof publishableKey !== 'string' || !publishableKey.trim()) {
    throw new Error('Supabase public client configuration is invalid.')
  }

  const cookieStore = await cookies()
  return createServerClient(
    supabaseUrl.trim(),
    publishableKey.trim(),
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
          } catch {}
        }
      }
    }
  )
}
