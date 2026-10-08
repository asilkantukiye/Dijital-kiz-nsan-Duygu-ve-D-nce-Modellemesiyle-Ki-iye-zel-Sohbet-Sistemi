'use client'

import { FormEvent, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'

function friendlyAuthError(message: string, mode: 'login' | 'signup') {
  const normalized = message.toLocaleLowerCase('tr-TR')

  if (normalized.includes('invalid login credentials')) {
    return 'E-posta veya şifre hatalı.'
  }

  if (normalized.includes('email not confirmed')) {
    return 'E-posta adresini doğruladıktan sonra giriş yapabilirsin.'
  }

  if (normalized.includes('user already registered')) {
    return 'Bu e-posta ile zaten bir hesap var. Giriş yapmayı deneyin.'
  }

  if (normalized.includes('password should be at least')) {
    return 'Şifre en az 6 karakter olmalıdır.'
  }

  return mode === 'signup'
    ? 'Kayıt sırasında bir sorun oluştu. Bilgilerini kontrol edip tekrar dene.'
    : 'Giriş sırasında bir sorun oluştu. Bilgilerini kontrol edip tekrar dene.'
}

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setMsg('')
    setLoading(true)

    try {
      const supabase = createClient()
      const result =
        mode === 'login'
          ? await supabase.auth.signInWithPassword({ email, password })
          : await supabase.auth.signUp({ email, password })

      if (result.error) {
        setMsg(friendlyAuthError(result.error.message, mode))
        return
      }

      if (mode === 'signup') {
        if (result.data.session) {
          window.location.href = '/'
        } else {
          setMsg('Kayıt başarılı. E-posta doğrulaması açıksa gelen kutunu kontrol et, ardından giriş yap.')
        }
      } else {
        window.location.href = '/'
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page">
      <main className="shell">
        <form className="card login" onSubmit={submit}>
          <div className="eyebrow">DİJİTAL İKİZ İNSAN</div>
          <h1>{mode === 'login' ? 'Giriş yap' : 'Hesap oluştur'}</h1>
          <p className="small">
            Bu hesap yalnızca araştırma prototipindeki sohbet geçmişini ve dijital ikiz profilini ilişkilendirmek için kullanılır.
          </p>

          <input
            type="email"
            required
            autoComplete="email"
            placeholder="E-posta"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />

          <input
            type="password"
            required
            minLength={6}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            placeholder="Şifre"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />

          {msg && <p className="small" role="status">{msg}</p>}

          <button className="btn" type="submit" disabled={loading}>
            {loading ? 'İşleniyor…' : mode === 'login' ? 'Giriş yap' : 'Kayıt ol'}
          </button>

          <button
            type="button"
            className="btn secondary"
            style={{ marginTop: 8 }}
            onClick={() => {
              setMode(mode === 'login' ? 'signup' : 'login')
              setMsg('')
            }}
          >
            {mode === 'login' ? 'Yeni hesap oluştur' : 'Mevcut hesabımla giriş yap'}
          </button>
        </form>
      </main>
    </div>
  )
}
