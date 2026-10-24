'use client'

import { useEffect, useRef, useState } from 'react'
import { chronologicalMessagesFromNewestFirst } from '@/lib/recent-messages'
import { normalizeProfile } from '@/lib/twin'
import { createClient } from '@/lib/supabase-browser'

type Message = {
  id?: string
  role: 'user' | 'assistant'
  content: string
  variant?: 'personalized' | 'baseline'
}

type Profile = {
  valence: number
  arousal: number
  dominance: number
  openness: number
  conscientiousness: number
  extraversion: number
  agreeableness: number
  neuroticism: number
  informality: number
  emoji_frequency: number
  humor: number
  slang: number
  avg_sentence_length: number
}

const emptyProfile: Profile = {
  valence: 0.5,
  arousal: 0.35,
  dominance: 0.5,
  openness: 0.5,
  conscientiousness: 0.5,
  extraversion: 0.5,
  agreeableness: 0.5,
  neuroticism: 0.5,
  informality: 0.45,
  emoji_frequency: 0,
  humor: 0.35,
  slang: 0.25,
  avg_sentence_length: 0.2
}

const labels: Record<keyof Profile, string> = {
  valence: 'Duygu dengesi',
  arousal: 'Uyarılmışlık',
  dominance: 'Kendinden eminlik',
  openness: 'Açıklık',
  conscientiousness: 'Sorumluluk',
  extraversion: 'Dışadönüklük',
  agreeableness: 'Uyumluluk',
  neuroticism: 'Duygusal hassasiyet',
  informality: 'Gündelik dil',
  emoji_frequency: 'Emoji sıklığı',
  humor: 'Mizah',
  slang: 'Argo / slang',
  avg_sentence_length: 'Cümle uzunluğu'
}

export default function Home() {
  const [session, setSession] = useState<any>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [profile, setProfile] = useState<Profile>(emptyProfile)
  const [error, setError] = useState('')
  const [loadingSession, setLoadingSession] = useState(true)
  const [loadingData, setLoadingData] = useState(false)
  const [feedback, setFeedback] = useState<Record<string, number>>({})
  const [savingFeedback, setSavingFeedback] = useState<Record<string, boolean>>({})
  const feedbackInFlight = useRef<Set<string>>(new Set())
  const chatSendInFlight = useRef(false)
  const [variant, setVariant] = useState<'personalized' | 'baseline'>('personalized')

  useEffect(() => {
    let mounted = true
    let supabase: ReturnType<typeof createClient>

    try {
      supabase = createClient()
    } catch {
      setError('Supabase ayarlarına erişilemedi. Bağlantı yapılandırmasını kontrol edin.')
      setLoadingSession(false)
      return () => {
        mounted = false
      }
    }

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return
      setSession(nextSession)
      setLoadingSession(false)
    })

    supabase.auth.getSession()
      .then(({ data: sessionData, error: sessionError }) => {
        if (sessionError) throw sessionError
        if (!mounted) return
        setSession(sessionData.session)
        setLoadingSession(false)
        setError('')
      })
      .catch(() => {
        if (!mounted) return
        setSession(null)
        setError('Oturum doğrulanamadı. İnternet bağlantını ve Supabase hizmetinin durumunu kontrol edip tekrar dene.')
        setLoadingSession(false)
      })

    return () => {
      mounted = false
      data.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!session?.user?.id) {
      setMessages([])
      setProfile(emptyProfile)
      return
    }

    let mounted = true

    async function loadData() {
      setLoadingData(true)

      try {
        const supabase = createClient()

        const [
          { data: storedMessages, error: messageError },
          { data: storedProfile, error: profileError },
          { data: storedFeedback, error: feedbackError }
        ] = await Promise.all([
          supabase
            .from('messages')
            .select('id,role,content,variant')
            .eq('user_id', session.user.id)
            .eq('variant', variant)
            .order('created_at', { ascending: false })
            .limit(100),
          supabase
            .from('twin_profiles')
            .select('profile')
            .eq('user_id', session.user.id)
            .maybeSingle(),
          supabase
            .from('message_feedback')
            .select('message_id,rating')
            .eq('user_id', session.user.id)
        ])

        if (!mounted) return

        if (messageError || profileError || feedbackError) {
          console.error('Data loading failed.')
          setError('Kayıtlı veriler yüklenemedi. Bağlantını kontrol edip tekrar dene.')
          return
        }

        setMessages(chronologicalMessagesFromNewestFirst(storedMessages) as Message[])
        setProfile(
          variant === 'personalized'
            ? normalizeProfile(storedProfile?.profile)
            : emptyProfile
        )
        const loadedFeedback: Record<string, number> = {}
        for (const item of storedFeedback ?? []) {
          if (typeof item.message_id === 'string' && Number.isInteger(item.rating)) {
            loadedFeedback[item.message_id] = item.rating
          }
        }
        setFeedback(loadedFeedback)
        setError('')
      } catch {
        if (!mounted) return
        setError('Kayıtlı veriler yüklenemedi. İnternet bağlantını ve Supabase hizmetinin durumunu kontrol edip tekrar dene.')
      } finally {
        if (mounted) setLoadingData(false)
      }
    }

    loadData()

    return () => {
      mounted = false
    }
  }, [session?.user?.id, variant])

  async function send() {
    if (
      !text.trim() ||
      chatSendInFlight.current ||
      loading ||
      loadingData ||
      !session?.user?.id
    ) return

    // Lock synchronously before state updates so rapid Enter/double-click
    // events cannot issue two paid model requests for the same draft.
    chatSendInFlight.current = true
    const userText = text.trim()
    const requestVariant = variant
    const optimisticUserMessage: Message = {
      role: 'user',
      content: userText,
      variant: requestVariant
    }
    setText('')
    setError('')
    setMessages((current) => [...current, optimisticUserMessage])
    setLoading(true)

    try {
      let response: Response | null = null
      for (let attempt = 0; attempt < 40; attempt += 1) {
        response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: userText, variant: requestVariant })
        })

        if (response.status !== 202) break

        // A duplicate request does not run another model call. Retry the same
        // prompt so the database-backed claim can return the original cached reply.
        await response.json().catch(() => ({}))
        const retryAfter = Number(response.headers.get('Retry-After'))
        const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(1000, retryAfter * 1000)
          : 500
        await new Promise((resolve) => setTimeout(resolve, delayMs))
      }

      if (!response) throw new Error('Sohbet isteği gönderilemedi.')
      if (response.status === 202) {
        throw new Error('Mesaj hâlâ işleniyor. Birkaç saniye sonra aynı mesajı tekrar deneyebilirsin.')
      }

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(data.error || 'İstek başarısız.')
      }

      setMessages((current) => [
        ...current,
        { id: data.messageId ?? undefined, role: 'assistant', content: data.reply, variant: data.variant ?? requestVariant }
      ])
      if (data.profile) setProfile(data.profile)
    } catch (error: unknown) {
      const message =
        error instanceof TypeError
          ? 'Bağlantı kurulamadı. Mesajını kaybettirmedim; bağlantını kontrol edip tekrar gönderebilirsin.'
          : error instanceof Error
            ? error.message
            : 'Mesaj gönderilemedi. Lütfen tekrar dene.'
      setError(message)
      // A failed request is not persisted as a successful chat turn. Restore
      // the draft so the user can retry instead of losing the message silently.
      setText(userText)
      setMessages((current) => current.filter((item) => item !== optimisticUserMessage))
    } finally {
      chatSendInFlight.current = false
      setLoading(false)
    }
  }

  async function rateMessage(
    messageId: string | undefined,
    rating: number,
    messageVariant: 'personalized' | 'baseline' = 'personalized'
  ) {
    if (!messageId) {
      setError('Bu yanıt için geri bildirim kimliği bulunamadı.')
      return
    }

    // Lock synchronously as well as in React state: two clicks before the next
    // render must not issue competing upserts for the same assistant message.
    if (feedbackInFlight.current.has(messageId)) return
    feedbackInFlight.current.add(messageId)
    setSavingFeedback((current) => ({ ...current, [messageId]: true }))
    setError('')

    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messageId,
          rating,
          variant: messageVariant
        })
      })

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        setError(data.error || 'Geri bildirim kaydedilemedi.')
        return
      }

      setFeedback((current) => ({ ...current, [messageId]: rating }))
    } catch {
      setError(
        'Bağlantı kesildi. Yanıt puanının kaydedilip kaydedilmediği doğrulanamadı; lütfen yeniden kontrol edin.'
      )
    } finally {
      feedbackInFlight.current.delete(messageId)
      setSavingFeedback((current) => {
        const next = { ...current }
        delete next[messageId]
        return next
      })
    }
  }

  async function clearData() {
    if (!session?.user?.id) return

    const confirmed = window.confirm(
      'Tüm sohbet geçmişini ve dijital ikiz profilini silmek istediğine emin misin? Bu işlem geri alınamaz.'
    )

    if (!confirmed) return

    setError('')

    try {
      const response = await fetch('/api/data', { method: 'DELETE' })
      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        setError(data.error || 'Veriler silinemedi.')
        return
      }

      setMessages([])
      setProfile(emptyProfile)
      setFeedback({})
    } catch {
      setError(
        'Bağlantı kesildi. Verilerin silinip silinmediği doğrulanamadı; silme durumunu yeniden kontrol edin.'
      )
    }
  }

  async function signOut() {
    setError('')

    try {
      const supabase = createClient()
      const { error: signOutError } = await supabase.auth.signOut()
      if (signOutError) throw signOutError
    } catch {
      setError('Çıkış yapılamadı. Lütfen bağlantınızı kontrol edip tekrar deneyin.')
    }
  }

  if (loadingSession) {
    return (
      <div className="page">
        <main className="shell">
          <div className="card login">
            <div className="eyebrow">DİJİTAL İKİZ İNSAN</div>
            <h1 className="title">Yükleniyor…</h1>
          </div>
        </main>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="page">
        <main className="shell">
          <div className="card login">
            <div className="eyebrow">TÜBİTAK AR-GE PROTOTİPİ</div>
            <h1 className="title">Dijital İkiz İnsan</h1>
            <p className="sub">
              Konuşma örneklerinden deneysel duygu, kişilik ve üslup göstergeleri çıkaran kişiselleştirilmiş sohbet prototipi.
            </p>
            {error && <p className="small" role="alert">{error}</p>}
            <a className="btn" style={{ display: 'inline-block', textDecoration: 'none' }} href="/login">
              Giriş / Kayıt
            </a>
            <p className="small privacy-note">
              Araştırma prototipidir; psikolojik tanı veya profesyonel terapi hizmeti sunmaz.
              {' '}<a href="/privacy">Gizlilik ve veri işleme</a>
            </p>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="page">
      <main className="shell">
        <header className="hero">
          <div>
            <div className="eyebrow">DİJİTAL İKİZ İNSAN • MVP v0.2</div>
            <h1 className="title">Seni öğrenen sohbet motoru.</h1>
            <p className="sub">
              Konuşma geçmişi + deneysel duygu + Big Five + üslup profili + Supabase hafızası.
            </p>
            <p className="small user-email">{session.user.email} · <a href="/about" style={{ color: "#8cc8ff" }}>Proje bilgisi</a></p>
          </div>

          <div className="toolbar">
            <button
              className="btn secondary"
              disabled={loading || loadingData}
              onClick={() => {
                setError('')
                setMessages([])
                setFeedback({})
                setProfile(emptyProfile)
                setVariant(variant === 'personalized' ? 'baseline' : 'personalized')
              }}
              title="Araştırma karşılaştırma koşulunu değiştir"
            >
              Test: {variant === 'personalized' ? 'Kişiselleştirilmiş' : 'Genel'}
            </button>
            <button className="btn secondary" disabled={loading || loadingData} onClick={clearData}>Verilerimi sil</button>
            <button className="btn" disabled={loading || loadingData} onClick={signOut}>Çıkış</button>
          </div>
        </header>

        <div className="privacy-banner">
          <strong>Deneysel sistem:</strong> Profil skorları doğrulanmış psikolojik ölçüm değildir. Mesajlar yanıt üretimi için harici yapay zekâ hizmetlerine gönderilebilir. <a href="/privacy">Gizlilik ve veri işleme</a>
        </div>

        <div className="grid">
          <section className="card chat" aria-label="Sohbet">
            <div className="messages" aria-live="polite">
              {loadingData && <div className="small">Kayıtlı sohbet yükleniyor…</div>}

              {!loadingData && messages.length === 0 && !loading && (
                <div className="small">
                  İlk mesajını yaz. Sistem mesajdan deneysel göstergeler çıkarıp yanıtı kişiselleştirecek ve hesabına kaydedecek.
                </div>
              )}

              {messages.map((message, index) => (
                <div key={message.id ?? `${message.role}-${index}`} className="message-row">
                  <div className={`msg ${message.role}`}>
                    {message.content}
                  </div>
                  {message.role === 'assistant' && (
                    <div className="message-meta">
                      <span className="small">
                        {message.variant === 'baseline' ? 'Genel koşul' : 'Kişiselleştirilmiş koşul'}
                      </span>
                    </div>
                  )}
                  {message.role === 'assistant' && message.id && (
                    <div className="feedback" aria-label="Yanıtı değerlendir">
                      <span className="small">Yanıt puanı:</span>
                      {[1, 2, 3, 4, 5].map((rating) => (
                        <button
                          key={rating}
                          type="button"
                          className={`feedback-btn ${feedback[message.id!] === rating ? 'selected' : ''}`}
                          disabled={Boolean(savingFeedback[message.id!])}
                          onClick={() => rateMessage(message.id, rating, message.variant ?? 'personalized')}
                          aria-label={`Puan ${rating}`}
                          aria-pressed={feedback[message.id!] === rating}
                        >
                          {rating}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}

              {loading && (
                <div className="msg assistant">
                  {variant === 'personalized'
                    ? 'Dijital ikiz profili analiz ediliyor…'
                    : 'Genel yanıt hazırlanıyor…'}
                </div>
              )}
            </div>

            <div className="composer">
              <input
                value={text}
                disabled={loading || loadingData}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    send()
                  }
                }}
                maxLength={4000}
                placeholder="Mesajını yaz…"
                aria-label="Mesaj"
              />
              <button className="btn" disabled={loading || loadingData || !text.trim()} onClick={send}>
                Gönder
              </button>
            </div>

            {error && <div className="error" style={{ padding: '0 14px 14px' }} role="alert">{error}</div>}
          </section>

          <aside className="card side">
            {variant === 'personalized' ? (
              <>
                <h3>Dijital İkiz Profili</h3>
                <p className="small">
                  Bu skorlar ilk MVP'de deneysel/heuristic baseline olarak kullanılır.
                </p>

                {Object.entries(profile).map(([key, value]) => (
              <div className="metric" key={key}>
                <span>{labels[key as keyof Profile]}</span>
                <div className="bar">
                  <div className="fill" style={{ width: `${Math.round(value * 100)}%` }} />
                </div>
                <small>{Math.round(value * 100)}%</small>
              </div>
                ))}
              </>
            ) : (
              <>
                <h3>Genel Koşul</h3>
                <p className="small">
                  Bu koşulda dijital ikiz profili modele verilmez. Karşılaştırma yanıtı genel sohbet bağlamında üretilir.
                </p>
              </>
            )}
          </aside>
        </div>
      </main>
    </div>
  )
}
