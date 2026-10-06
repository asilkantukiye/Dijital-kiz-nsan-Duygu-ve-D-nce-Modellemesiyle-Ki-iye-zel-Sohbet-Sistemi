'use client'

import { useEffect } from 'react'

export default function Error({
  error,
  reset
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="page">
      <main className="shell">
        <div className="card login">
          <div className="eyebrow">DİJİTAL İKİZ İNSAN</div>
          <h1>Bir hata oluştu</h1>
          <p className="sub">
            Uygulama beklenmeyen bir sorunla karşılaştı. Tekrar deneyebilirsin.
          </p>
          <button className="btn" onClick={() => reset()}>
            Tekrar dene
          </button>
        </div>
      </main>
    </div>
  )
}
