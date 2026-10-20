import { NextResponse } from 'next/server'
import { rejectCrossOrigin } from '@/lib/api-security'
import { createClient } from '@/lib/supabase-server'

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

    // Keep deletion in one Postgres function call so a database error cannot
    // leave only some of the requested chat/profile/memory data removed.
    const { error } = await supabase.rpc('delete_my_chat_data')
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
