# MVP Kabul Testleri

Bu liste yazılımın çalıştığını göstermek için kullanılabilir.

## Kimlik doğrulama

- [ ] Yeni kullanıcı kayıt olabilir.
- [ ] E-posta doğrulaması açıksa kullanıcı bilgilendirilir.
- [ ] Mevcut kullanıcı giriş yapabilir.
- [ ] Oturum yokken ana uygulama giriş ekranını gösterir.
- [ ] Çıkış yapınca oturum kapanır.

## Sohbet

- [ ] Oturum açmış kullanıcı mesaj gönderebilir.
- [ ] Boş mesaj gönderilemez.
- [ ] 4000 karakterden uzun mesaj reddedilir.
- [ ] Kontrol karakterleri güvenli biçimde temizlenir.
- [ ] LLM yanıtı arayüzde görünür.
- [ ] Kişiselleştirilmiş ve genel test varyantları arasında geçiş yapılabilir.
- [ ] Bir varyantın konuşma geçmişi diğer varyanta karışmaz.
- [ ] Son konuşma bağlamı sonraki istekte kullanılır.
- [ ] Konuşma geçmişinin modele aktarılan toplam boyutu sınırlandırılır.
- [ ] Sayfa yenilendiğinde kayıtlı sohbet geçmişi yüklenir.

## Dijital ikiz profili

- [ ] İlk mesajdan sonra profil oluşturulur.
- [ ] Sonraki mesajlar önceki profile göre ağırlıklı güncelleme yapar.
- [ ] Profil değerleri 0–1 aralığında kalır.
- [ ] Profil göstergeleri arayüzde görünür.
- [ ] Profilin deneysel olduğu açıkça belirtilir.
- [ ] Baseline koşulu kişiselleştirilmiş profil durumunu güncellemez.

## Veri güvenliği

- [ ] Supabase RLS açık olmalıdır.
- [ ] Kullanıcı yalnızca kendi mesaj ve profil kayıtlarına erişmelidir.
- [ ] API istekleri aktif oturum olmadan reddedilmelidir.
- [ ] Chat ve feedback gibi tarayıcı mutasyon API'leri farklı Origin değerleriyle reddedilmelidir.
- [ ] HF token yalnızca sunucu ortamında tutulmalıdır.
- [ ] `.env.local` Git'e gönderilmemelidir.
- [ ] API yanıtlarında `Cache-Control: no-store` bulunmalıdır.
- [ ] API istek limiti test edilmelidir.
- [ ] Rate-limit belleği sabit üst sınırı aşmamalıdır.
- [ ] Sağlayıcı hata gövdeleri kullanıcıya taşınmamalıdır.
- [ ] Kullanıcı "Verilerimi sil" işlemi ile kendi verilerini silebilmelidir.
- [ ] Asistan yanıtlarına 1–5 puan verilebilir.
- [ ] Geri bildirimler doğru varyant bilgisiyle saklanmalıdır.
- [ ] Kullanıcı/sağlayıcı metinleri sistem talimatı gibi yorumlanmamalıdır.

## Dağıtım

- [ ] `/api/health` 200 döndürmelidir.
- [ ] Vercel üzerinde build başarıyla tamamlanmalıdır.
- [ ] Supabase URL ve publishable key doğru ayarlanmalıdır.
- [ ] Hugging Face Inference Providers tokenı doğru ayarlanmalıdır.

## Ar-Ge

Bu test listesi yazılım doğrulamasıdır. Duygu/kişilik modellerinin bilimsel doğruluğu ayrıca etiketli veri ve ayrı test seti ile ölçülmelidir.
