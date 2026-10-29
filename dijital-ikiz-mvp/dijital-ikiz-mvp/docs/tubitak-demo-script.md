# TÜBİTAK Demo Akışı

## Amaç

Bu demo, MVP'nin raporda tanımlanan mimariyi nasıl gerçekleştirdiğini gösterir. Demo, bilimsel doğruluk iddiası değil yazılım prototipi gösterimidir.

## 1. Giriş

Ana sayfada proje adı ve deneysel sistem uyarısı gösterilir.

## 2. Oturum

Arayüzde e-posta/şifre giriş ekranı bulunmaz. Uygulama anonim Supabase oturumu oluşturur. İlk açılışta oturumun başarıyla kurulduğu ve sohbet ekranının kullanılabilir olduğu gösterilir; kullanıcıya tarayıcı verileri silinirse anonim oturuma erişimin kaybolabileceği açıklanır.

## 3. İlk sohbet

Kullanıcı birkaç farklı mesaj gönderir:
- nötr bir cümle,
- olumlu/heyecanlı bir cümle,
- gündelik/emoji içeren bir cümle.

Sağ panelde deneysel profil göstergelerinin güncellendiği gösterilir.

## 4. Kalıcılık

Sayfa yenilenir ve sohbet geçmişinin kullanıcı hesabına bağlı şekilde yeniden yüklendiği gösterilir.

## 5. A/B karşılaştırması

Üstteki test düğmesi ile:
- Kişiselleştirilmiş koşul
- Genel koşul

arasında geçiş yapılır.

Aynı veya benzer bir mesaj iki koşulda gönderilir. Yanıtlar 1–5 puan ile değerlendirilebilir.

## 6. Veri kontrolü

“Verilerimi sil” işlemi gösterilir. Bu işlem kullanıcının kendi mesaj ve profil verisini temizler.

## 7. Teknik açıklama

Demo sırasında şu mimari anlatılabilir:

Kullanıcı mesajı → Next.js API → Supabase geçmiş/profil → deneysel profil çıkarımı → Qwen LLM → yanıt → Supabase kayıt.

## 8. Bilimsel açıklama

Açıkça belirtilmelidir:

- MVP profil skorları heuristic baseline'dır.
- %75 hedefi rapordaki Ar-Ge hedefidir; henüz ölçülmüş bir sonuç olarak sunulmamalıdır.
- Gerçek duygu ve kişilik modeli, etiketli veri ve ayrı test kümesi ile daha sonraki Ar-Ge adımında değerlendirilecektir.

## 9. Demo öncesi kontrol

- Gerekli Supabase migration'ları uygulanmış ve RLS kontrol edilmiş.
- Vercel Production ortamında Supabase, HF, Upstash, rate-limit salt ve health check ayarları tanımlanmış; değerleri rapor veya ekran görüntüsünde ifşa edilmemiş.
- Son commit için production build/deployment başarılı ve `/api/health` doğrulanmış.
- İki ayrı test oturumuyla veri izolasyonu, sohbet, yenileme ve silme kontrol edilmiş.
- Kullanılan model açıkça belirtilmiş: LoRA endpoint'i tamamlanmadıysa demo temel Qwen modelini kullanır; yüklenen adaptörün uygulamada çalıştığı iddia edilmez.
