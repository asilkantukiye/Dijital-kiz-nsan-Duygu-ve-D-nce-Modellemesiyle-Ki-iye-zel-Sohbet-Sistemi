import Link from 'next/link'

export default function PrivacyPage() {
  return (
    <div className="page">
      <main className="shell">
        <div className="card login">
          <div className="eyebrow">GİZLİLİK VE VERİ İŞLEME</div>
          <h1>Dijital İkiz İnsan</h1>
          <p className="sub">
            Bu sayfa, mevcut araştırma prototipinin hangi verileri kullandığını ve verilerin hangi hizmetlerden geçebildiğini açıklar.
          </p>

          <h2>Bu prototip hangi verileri işler?</h2>
          <p className="small">
            Hesap/oturum bilgileri; gönderdiğin mesajlar ve üretilen yanıtlar; kişiselleştirilmiş koşulda deneysel profil göstergeleri ve sınırlı tercih/iletişim belleği; yanıtlar için verdiğin 1–5 puanlar.
          </p>

          <h2>Harici yapay zekâ hizmetleri</h2>
          <p className="small">
            Yanıt üretmek için mesajın, seçilen koşula ait sınırlı konuşma geçmişi ve o koşulda kullanılan bağlam Hugging Face çıkarım hizmetine gönderilebilir. Kişiselleştirilmiş koşulda bellek araması ve belleğe yazma için metinden türetilen kısa bellek adayları/arama metni Hugging Face embedding hizmetine de gönderilebilir. Genel (baseline) koşulunda kullanıcı profili ve kayıtlı bellek modele eklenmez.
          </p>
          <p className="small">
            Bu uygulama, üçüncü taraf sağlayıcıların kendi altyapılarındaki veri işleme ve saklama uygulamalarını bağımsız olarak denetlemez. Bu nedenle mesajlara parola, API anahtarı, finansal bilgiler, kimlik numarası, özel sağlık bilgisi veya paylaşmak istemediğin hassas ayrıntılar yazma. Sağlayıcıların güncel gizlilik ve kullanım koşullarını ayrıca incele.
          </p>

          <h2>Veriler nerede saklanır?</h2>
          <p className="small">
            Uygulama hesabı, sohbet geçmişi, profil, bellek ve geri bildirim kayıtları Supabase veritabanında tutulur. Kod, kullanıcı kayıtlarını oturum açmış hesabın kimliğiyle sınırlar (Row Level Security). Bu teknik kontrol, canlı hizmetin her an erişilebilir olduğunu veya bütünleşik uçtan uca testlerin tamamlandığını tek başına kanıtlamaz.
          </p>
          <p className="small">
            Sohbet kayıtları, kullanıcı silme işlemi yapana kadar saklanabilir. Bellek kayıtları için 180 günlük etkin olmama hedefi uygulanır: güncelleme zamanı 180 günden eski olan ve son kullanım zamanı da bulunmayan ya da 180 günden eski olan kayıtlar zamanlanmış veritabanı temizliğiyle silinmek üzere seçilir. Temizlik işi en fazla 1.000 kayıtlık partilerle yaklaşık her 15 dakikada bir çalışır; önceki sürümde birikmiş hesap-başı 50 kayıt üzeri bellek fazlası ayrıca gecelik partilerle temizlenir. Bu süre mutlak oluşturulma tarihinden itibaren azami saklama süresi değildir: yakın zamanda kullanılan/güncellenen eski bir bellek tutulabilir. Bu kural yalnız kayıtlı bellek içindir; sohbet geçmişi, profiller, yedekler ve harici sağlayıcıların logları için ayrı saklama kuralları geçerlidir. Kullanıcıya ait veri silme işlemi ayrıca kullanılabilir.
          </p>

          <h2>Verilerimi sil</h2>
          <p className="small">
            Uygulamadaki “Verilerimi sil” işlemi sohbet mesajlarını, dijital ikiz profilini ve kayıtlı bellekleri silmek için tasarlanmıştır; mesajlara bağlı geri bildirimler de veritabanı ilişkisine göre silinir. Bu işlem oturum açma hesabını silmez. Ağ veya veritabanı hatasında silme tamamlanmış olmayabilir; arayüz başarı yanıtı alınamadığında bunu açıkça bildirir.
          </p>

          <h2>Araştırma ve bilimsel sınırlar</h2>
          <p className="small">
            Bu, deneysel bir TÜBİTAK yazılım prototipidir. Profil puanları doğrulanmış psikolojik test veya klinik değerlendirme değildir. Gerçek katılımcılarla araştırma yürütmeden önce danışman/kurum izni, gerekli bilgilendirilmiş onam ve reşit olmayan katılımcılar için gerekli ek izinler tamamlanmalıdır.
          </p>
          <p className="small">
            Katılım gönüllü olmalı; araştırma için veri dışa aktarılacaksa doğrudan tanımlayıcı bilgiler çıkarılmalı ve yalnızca izin verilen veri kullanılmalıdır. Bu sayfa kurumun resmî gizlilik bildirimi veya hukuk danışmanlığı yerine geçmez.
          </p>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 18 }}>
            <Link href="/" className="btn" style={{ textDecoration: 'none' }}>
              Uygulamaya dön
            </Link>
            <Link href="/about" className="btn secondary" style={{ textDecoration: 'none' }}>
              Proje bilgisi
            </Link>
          </div>
        </div>
      </main>
    </div>
  )
}
