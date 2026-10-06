import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'

export async function DELETE() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Oturum bulunamadı.' }, { status: 401 })
    }

    const [{ error: messagesError }, { error: profileError }] = await Promise.all([
      supabase.from('messages').delete().eq('user_id', user.id),
      supabase.from('twin_profiles').delete().eq('user_id', user.id)
    ])

    if (messagesError) throw messagesError
    if (profileError) throw profileError

    return NextResponse.json({ ok: true })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Veriler silinemedi.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
