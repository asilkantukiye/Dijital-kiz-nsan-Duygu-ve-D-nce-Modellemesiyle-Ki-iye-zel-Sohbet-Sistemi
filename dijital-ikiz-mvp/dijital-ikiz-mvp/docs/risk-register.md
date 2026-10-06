# Risk Kaydı

| Risk | Olası etki | Önlem | Durum |
|---|---|---|---|
| Kişisel veri sızıntısı | Gizlilik ihlali | RLS, veri minimizasyonu, kullanıcı silme, secret yönetimi | Sürekli izlenecek |
| Eğitim/test kişi sızıntısı | Şişirilmiş performans | participant_id bazlı split | Tasarlandı |
| Heuristic skorların bilimsel sonuç sanılması | Geçersiz raporlama | MVP'de açık uyarılar + deney protokolü | Kontrol altında |
| Üçüncü taraf LLM bağımlılığı | Maliyet/erişim değişikliği | Model sağlayıcısını soyutlayan istemci | İzlenecek |
| LLM istem manipülasyonu | Güvenlik sorunu | Sunucu oturumu + sistem talimatı sınırları | Kontrol altında |
| Çocuk kullanıcılarla erken deney | Etik/hukuki risk | Uygun onam/etik süreç olmadan gerçek çalışma yapılmaması | Bloklayıcı |
| Vercel Git entegrasyonu yok | Dağıtım gecikmesi | Vercel Dashboard'dan GitHub bağlantısı | Açık |
| Veri API expose ayarı | Uygulama erişim hatası | Kullanılan tabloları açıkça expose etme | Açık |

## Genel kural

Bir risk için çözüm uygulanmadan önce “tamamlandı” olarak işaretlenmemelidir.
