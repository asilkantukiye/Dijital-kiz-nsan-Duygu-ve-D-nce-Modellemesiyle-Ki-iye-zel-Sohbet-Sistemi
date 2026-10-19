import { NextResponse } from 'next/server'
import { rejectCrossOrigin } from '@/lib/api-security'
import { createClient } from '@/lib/supabase-server'
import { validateFeedbackPayload } from '@/lib/feedback-validation'
import { readJsonBodyLimited } from '@/lib/request-body'

export async function POST(req: Request) {
  try {
    const originError = rejectCrossOrigin(req)
    if (originError) return originError

    const bodyResult = await readJsonBodyLimited(req, 8 * 1024)
    if (!bodyResult.ok) {
      return NextResponse.json(
        { error: bodyResult.error },
        {
          status: bodyResult.status,
          headers: { 'Cache-Control': 'no-store' }
        }
      )
    }

    const validation = validateFeedbackPayload(bodyResult.value)

    if (!validation.ok) {
      return NextResponse.json(
        { error: validation.error },
        {
          status: 400,
          headers: { 'Cache-Control': 'no-store' }
        }
      )
    }

    const {
      messageId,
      rating,
      comment,
      variant: requestedVariant
    } = validation.value

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json(
        { error: 'Oturum bulunamadı.' },
        { status: 401, headers: { 'Cache-Control': 'no-store' } }
      )
    }

    const { data: message, error: messageError } = await supabase
      .from('messages')
      .select('id,variant')
      .eq('id', messageId)
      .eq('user_id', user.id)
      .eq('role', 'assistant')
      .maybeSingle()

    if (messageError) throw messageError

    if (!message) {
      return NextResponse.json(
        { error: 'Mesaj bulunamadı.' },
        { status: 404, headers: { 'Cache-Control': 'no-store' } }
      )
    }

    if (message.variant !== requestedVariant) {
      return NextResponse.json(
        { error: 'Geri bildirim varyantı mesajla eşleşmiyor.' },
        {
          status: 409,
          headers: { 'Cache-Control': 'no-store' }
        }
      )
    }

    const { error } = await supabase
      .from('message_feedback')
      .upsert(
        {
          message_id: messageId,
          user_id: user.id,
          rating,
          variant: message.variant,
          comment
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
