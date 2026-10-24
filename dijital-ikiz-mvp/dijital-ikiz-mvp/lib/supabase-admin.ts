import 'server-only'

import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { isValidSupabaseUrl } from './supabase-url.ts'

/**
 * Server-only Supabase client for trusted write operations.
 *
 * Never use this helper in client components or prefix the service key with
 * NEXT_PUBLIC_. User-facing requests must still authenticate with auth.getUser()
 * and derive the user id from that verified session before invoking server RPCs.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (typeof url !== 'string' || !isValidSupabaseUrl(url)) {
    throw new Error('Supabase URL configuration is invalid.')
  }
  if (typeof serviceRoleKey !== 'string' || !serviceRoleKey.trim()) {
    throw new Error('Supabase server write key is not configured.')
  }

  return createSupabaseClient(url.trim(), serviceRoleKey.trim(), {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false
    }
  })
}
