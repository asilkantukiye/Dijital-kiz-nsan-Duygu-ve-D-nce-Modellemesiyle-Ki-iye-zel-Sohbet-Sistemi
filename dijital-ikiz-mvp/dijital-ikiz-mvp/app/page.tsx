'use client'

import { useEffect, useState } from 'react'
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
  const [variant, setVariant] = useState<'personalized' | 'baseline'>('personalized')

  useEffect(() => {
    let mounted = true

    const supabase = createClient()

    supabase.auth.getSession().then(({ data }) => {
      if (mounted) {
        setSession(data.session)
        setLoadingSession(false)
      }
    })

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
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
          .order('created_at', { ascending: true })
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
        console.error('Data loading error', messageError || profileError || feedbackError)
        setError('Kayıtlı veriler yüklenemedi. Lütfen tekrar deneyin.')
      } else {
        setMessages((storedMessages ?? []) as Message[])
        setProfile(
          variant === 'personalized'
            ? ((storedProfile?.profile as Profile | null) ?? emptyProfile)
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
      }

      setLoadingData(false)
    }

    loadData()

    return () => {
      mounted = false
    }
  }, [session?.user?.id, variant])

  async function send() {
    if (!text.trim() || loading || !session?.user?.id) return

    const userText = text.trim()
    setText('')
    setError('')
    setMessages((current) => [...current, { role: 'user', content: userText, variant }])
    setLoading(true)

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userText, variant })
      })

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(data.error || 'İstek başarısız.')
      }

      setMessages((current) => [
        ...current,
        { id: data.messageId ?? undefined, role: 'assistant', content: data.reply, variant: data.variant ?? variant }
      ])
      if (data.profile) setProfile(data.profile)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Bir hata oluştu.'
      setError(message)
      setMessages((current) => current.slice(0, -1))
    } finally {
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
  }

  async function clearData() {
    if (!session?.user?.id) return

    const confirmed = window.confirm(
      'Tüm sohbet geçmişini ve dijital ikiz profilini silmek istediğine emin misin? Bu işlem geri alınamaz.'
    )

    if (!confirmed) return

    setError('')

    const response = await fetch('/api/data', { method: 'DELETE' })
    const data = await response.json().catch(() => ({}))

    if (!response.ok) {
      setError(data.error || 'Veriler silinemedi.')
      return
    }

    setMessages([])
    setProfile(emptyProfile)
    setFeedback({})
  }

  async function signOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
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
            <a className="btn" style={{ display: 'inline-block', textDecoration: 'none' }} href="/login">
              Giriş / Kayıt
            </a>
            <p className="small privacy-note">
              Araştırma prototipidir; psikolojik tanı veya profesyonel terapi hizmeti sunmaz.
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
              onClick={() => setVariant(variant === 'personalized' ? 'baseline' : 'personalized')}
              title="Araştırma karşılaştırma koşulunu değiştir"
            >
              Test: {variant === 'personalized' ? 'Kişiselleştirilmiş' : 'Genel'}
            </button>
            <button className="btn secondary" onClick={clearData}>Verilerimi sil</button>
            <button className="btn" onClick={signOut}>Çıkış</button>
          </div>
        </header>

        <div className="privacy-banner">
          <strong>Deneysel sistem:</strong> Profil skorları doğrulanmış psikolojik ölçüm değildir. Bu sürüm Ar-Ge mimarisini ve sohbet akışını test etmek içindir.
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
                          onClick={() => rateMessage(message.id, rating, message.variant ?? 'personalized')}
                          aria-label={`Puan ${rating}`}
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
              <button className="btn" disabled={loading || !text.trim()} onClick={send}>
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
