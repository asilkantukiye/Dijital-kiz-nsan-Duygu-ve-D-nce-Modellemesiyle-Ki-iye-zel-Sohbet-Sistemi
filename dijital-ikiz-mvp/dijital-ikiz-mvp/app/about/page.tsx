import Link from 'next/link'

export default function About() {
  return (
    <div className="page">
      <main className="shell">
        <div className="card login">
          <div className="eyebrow">PROJE BİLGİSİ</div>
          <h1>Dijital İkiz İnsan</h1>
          <p className="sub">
            Kullanıcının konuşma örneklerinden deneysel duygu, kişilik ve üslup özellikleri çıkararak kişiselleştirilmiş sohbet üretmeyi araştıran TÜBİTAK yazılım prototipi.
          </p>

          <h2>Bu sürüm ne yapar?</h2>
          <p className="small">
            Kullanıcı hesabı, sohbet geçmişi, deneysel profil güncellemesi ve Hugging Face üzerinden LLM yanıtı tek bir web uygulamasında birleştirilmiştir.
          </p>

          <h2>Bilimsel sınır</h2>
          <p className="small">
            Profil göstergeleri bu MVP'de heuristic baseline'dır. Psikolojik test veya klinik değerlendirme değildir. Raporlanan doğruluk değerleri yalnızca kontrollü deneylerle ölçüldükten sonra sonuç olarak yazılmalıdır.
          </p>

          <h2>Gizlilik</h2>
          <p className="small">
            Sohbet, profil ve bellek kayıtları Supabase'te tutulabilir. Yanıt üretimi ve kişiselleştirilmiş bellek işlemleri için gerekli metin parçaları Hugging Face hizmetlerine gönderilebilir. Ayrıntılar için gizlilik ve veri işleme sayfasını inceleyin.
          </p>
          <p className="small">
            Uygulamadaki veri silme işlemi oturum hesabını silmez; harici sağlayıcıların kendi veri işleme uygulamalarını da bu prototip bağımsız olarak denetlemez.
            {' '}<Link href="/privacy">Gizlilik ve veri işleme</Link>
          </p>

          <Link href="/" className="btn" style={{ display: 'inline-block', marginTop: 12, textDecoration: 'none' }}>
            Uygulamaya dön
          </Link>
        </div>
      </main>
    </div>
  )
}
