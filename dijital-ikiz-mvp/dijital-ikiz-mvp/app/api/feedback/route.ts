import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    const messageId = String(body.messageId ?? '').trim()
    const rating = Number(body.rating)
    const comment = typeof body.comment === 'string' ? body.comment.trim() : null
    const variant = body.variant === 'baseline' ? 'baseline' : 'personalized'

    if (!messageId) {
      return NextResponse.json({ error: 'Mesaj kimliği gerekli.' }, { status: 400 })
    }

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return NextResponse.json({ error: 'Puan 1 ile 5 arasında olmalıdır.' }, { status: 400 })
    }

    if (comment && comment.length > 1000) {
      return NextResponse.json({ error: 'Yorum en fazla 1000 karakter olabilir.' }, { status: 400 })
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Oturum bulunamadı.' }, { status: 401 })
    }

    const { data: message, error: messageError } = await supabase
      .from('messages')
      .select('id')
      .eq('id', messageId)
      .eq('user_id', user.id)
      .eq('role', 'assistant')
      .maybeSingle()

    if (messageError) throw messageError

    if (!message) {
      return NextResponse.json({ error: 'Mesaj bulunamadı.' }, { status: 404 })
    }

    const { error } = await supabase
      .from('message_feedback')
      .upsert(
        {
          message_id: messageId,
          user_id: user.id,
          rating,
          variant,
          comment: comment || null
        },
        { onConflict: 'message_id,user_id' }
      )

    if (error) throw error

    return NextResponse.json(
      { ok: true },
      {
        headers: {
          'Cache-Control': 'no-store'
        }
      }
    )
  } catch (error: unknown) {
    console.error('Feedback API error:', error)
    return NextResponse.json(
      { error: 'Geri bildirim kaydedilemedi. Lütfen daha sonra tekrar deneyin.' },
      {
        status: 500,
        headers: {
          'Cache-Control': 'no-store'
        }
      }
    )
  }
}
