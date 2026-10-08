# Risk Kaydı

| Risk | Olası etki | Önlem | Durum |
|---|---|---|---|
| Kişisel veri sızıntısı | Gizlilik ihlali | RLS, veri minimizasyonu, kullanıcı silme, secret yönetimi | Sürekli izlenecek |
| Eğitim/test kişi sızıntısı | Şişirilmiş performans | participant_id bazlı split | Tasarlandı |
| Heuristic skorların bilimsel sonuç sanılması | Geçersiz raporlama | MVP'de açık uyarılar + deney protokolü | Kontrol altında |
| Üçüncü taraf LLM bağımlılığı | Maliyet/erişim değişikliği | Model sağlayıcısını soyutlayan istemci | İzlenecek |
| LLM istem manipülasyonu | Güvenlik sorunu | Sunucu oturumu, same-origin kontrolü, güvenilmeyen veri ayrımı ve bounded context | Kontrol altında |
| API belleğinin sınırsız büyümesi | Kaynak tüketimi | Process-local rate limiter için sabit üst sınır + expired kayıt temizliği | Kontrol altında |
| Sağlayıcı hata ayrıntılarının sızması | Gizli operasyonel bilgi ifşası | HF hata gövdelerini uygulama hatasına taşımama | Kontrol altında |
| Çocuk kullanıcılarla erken deney | Etik/hukuki risk | Uygun onam/etik süreç olmadan gerçek çalışma yapılmaması | Bloklayıcı |
| Vercel Git entegrasyonu yok | Dağıtım gecikmesi | Vercel Dashboard'dan GitHub bağlantısı | Açık |
| Vercel deployment secrets eksik | Otomatik dağıtımın çalışmaması | GitHub Secrets'ta gerekli Vercel bilgilerini tanımlama | Açık |
| Hugging Face token eksik | Üretim sohbetinin çalışmaması | Vercel Environment Variables içinde HF_TOKEN tanımlama | Açık |
| Veri API expose ayarı | Uygulama erişim hatası | Kullanılan tabloları açıkça expose etme | Açık |

## Genel kural

Bir risk için çözüm uygulanmadan önce “tamamlandı” olarak işaretlenmemelidir.

## Teknik not

Process-local rate limiter, serverless ortamda instance bazlıdır; dağıtık kötüye kullanım önleme sistemi olarak değerlendirilmemelidir. Trafik büyüdüğünde merkezi rate-limit altyapısı planlanmalıdır.
