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
      return NextResponse.json({ error: 'Oturum bulunamadı.' }, { status: 401 })
    }

    const [{ error: messagesError }, { error: profileError }, { error: memoryError }] = await Promise.all([
      supabase.from('messages').delete().eq('user_id', user.id),
      supabase.from('twin_profiles').delete().eq('user_id', user.id),
      supabase.from('memory_items').delete().eq('user_id', user.id)
    ])

    if (messagesError) throw messagesError
    if (profileError) throw profileError
    if (memoryError) throw memoryError

    return NextResponse.json(
      { ok: true },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (error: unknown) {
    console.error('Data deletion API error:', error)
    return NextResponse.json(
      { error: 'Veriler silinemedi. Lütfen daha sonra tekrar deneyin.' },
      {
        status: 500,
        headers: { 'Cache-Control': 'no-store' }
      }
    )
  }
}
