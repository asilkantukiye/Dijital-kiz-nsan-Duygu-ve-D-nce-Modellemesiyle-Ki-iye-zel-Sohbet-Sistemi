import { NextResponse } from 'next/server'
import { rejectCrossOrigin } from '@/lib/api-security'
import { createClient } from '@/lib/supabase-server'
import { createAdminClient } from '@/lib/supabase-admin'

export async function DELETE(req: Request) {
  try {
    const originError = rejectCrossOrigin(req)
    if (originError) return originError

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json(
        { error: 'Oturum bulunamadı.' },
        { status: 401, headers: { 'Cache-Control': 'no-store' } }
      )
    }

    // This server-only RPC invalidates in-flight chat claims and serializes with
    // chat persistence. User identity comes only from the verified cookie session.
    const adminSupabase = createAdminClient()
    const { error } = await adminSupabase.rpc('delete_my_chat_data_server', {
      p_user_id: user.id
    })
    if (error) throw error

    return NextResponse.json(
      { ok: true },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (error: unknown) {
    console.error('Data deletion request failed; diagnostic details omitted.')
    return NextResponse.json(
      { error: 'Veriler silinemedi. Lütfen daha sonra tekrar deneyin.' },
      {
        status: 500,
        headers: { 'Cache-Control': 'no-store' }
      }
    )
  }
}
