import Link from 'next/link'

export default function Privacy() {
  return (
    <div className="page">
      <main className="shell">
        <div className="card login">
          <div className="eyebrow">GİZLİLİK VE VERİ KULLANIMI</div>
          <h1>Verilerin nasıl kullanılıyor?</h1>

          <h2>Toplanan veriler</h2>
          <p className="small">
            MVP; hesap bilgisi, sohbet mesajları ve bu mesajlardan üretilen deneysel dijital ikiz profil göstergelerini saklar.
          </p>

          <h2>Neden saklanıyor?</h2>
          <p className="small">
            Sohbet geçmişi, kişiselleştirilmiş yanıt üretimi ve Ar-Ge deneylerinin tekrarlanabilirliği için kullanılır.
          </p>

          <h2>Yapay zekâ hizmeti</h2>
          <p className="small">
            Yanıt üretimi için yapılandırılmış bir üçüncü taraf model hizmeti kullanılabilir. Gerçek kullanıcı verileriyle araştırma yapılmadan önce veri paylaşımı, izin/onam ve gerekli veri koruma süreçleri ayrıca değerlendirilmelidir.
          </p>

          <h2>Silme</h2>
          <p className="small">
            Giriş yapılmış kullanıcı, uygulamadaki “Verilerimi sil” düğmesiyle kendi sohbet ve dijital ikiz profilini silebilir.
          </p>

          <h2>Araştırma sınırı</h2>
          <p className="small">
            Profil skorları klinik değerlendirme değildir. Çocuklar veya psikolojik destek amacıyla gerçek kullanıcı çalışmasına geçmeden önce uygun etik, ebeveyn/onam ve uzman denetimi süreçleri tamamlanmalıdır.
          </p>

          <Link href="/" className="btn" style={{ display: 'inline-block', marginTop: 12, textDecoration: 'none' }}>
            Uygulamaya dön
          </Link>
        </div>
      </main>
    </div>
  )
}
