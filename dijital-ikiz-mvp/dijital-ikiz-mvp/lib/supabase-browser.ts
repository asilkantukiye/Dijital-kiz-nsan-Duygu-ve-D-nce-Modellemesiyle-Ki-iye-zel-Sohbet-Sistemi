import { createBrowserClient } from '@supabase/ssr'
import { isValidSupabaseUrl } from './supabase-url'

export function createClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if (typeof supabaseUrl !== 'string' || !isValidSupabaseUrl(supabaseUrl) || typeof publishableKey !== 'string' || !publishableKey.trim()) {
    throw new Error('Supabase public client configuration is invalid.')
  }

  return createBrowserClient(supabaseUrl.trim(), publishableKey.trim())
}
