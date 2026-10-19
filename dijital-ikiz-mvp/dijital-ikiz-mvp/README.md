# Dijital İkiz İnsan — MVP

TÜBİTAK projesi için geliştirilen ilk çalışan prototiptir. Proje, kullanıcının konuşma örneklerinden deneysel duygu, Big Five kişilik ve ifade/üslup göstergeleri çıkararak kişiselleştirilmiş bir sohbet akışı oluşturmayı amaçlar.

## Mimari

- **Next.js + React + TypeScript:** web uygulaması ve API route'ları
- **Supabase:** kullanıcı kimlik doğrulama, sohbet geçmişi ve dijital ikiz profilinin saklanması
- **Hugging Face Inference Providers:** LLM tabanlı sohbet üretimi
- **Qwen:** ilk MVP üretici model
- **GitHub:** kaynak kodu ve sürüm kontrolü
- **Vercel:** üretim dağıtımı
- **Kaggle:** sonraki Ar-Ge aşamasında veri hazırlama/model eğitimi ve deneyler

Akış:

```
Kullanıcı
  ↓
Next.js arayüzü
  ↓
/api/chat
  ├─ Supabase oturumu doğrula
  ├─ Önceki profil + varyanta ait son 8 mesajı oku
  ├─ Profil güncelle (yalnızca personalized)
  ├─ LLM yanıtını üret
  └─ Profil + mesajları kaydet
  ↓
Kişiselleştirilmiş veya genel yanıt
```

## 1. Gereksinimler

- Node.js 22 LTS veya daha yeni bir desteklenen LTS sürüm
- Supabase projesi
- Hugging Face Inference Providers izni olan bir token

## 2. Kurulum

Windows PowerShell:

```powershell
cd dijital-ikiz-mvp\dijital-ikiz-mvp
npm install
Copy-Item .env.local.example .env.local
```

`.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
HF_TOKEN=
HF_MODEL=Qwen/Qwen3-4B-Instruct-2507
HF_EMBEDDING_MODEL=intfloat/multilingual-e5-small
```

**Gizli anahtarları GitHub'a yüklemeyin.** `.env.local` `.gitignore` içindedir.

## 3. Supabase kurulumu

Supabase Dashboard → **SQL Editor** üzerinden `supabase/schema.sql` dosyasını çalıştırın.

Bu SQL:

- `twin_profiles` tablosunu oluşturur.
- `messages` tablosunu oluşturur.
- `message_feedback` tablosunu oluşturur.
- RLS'yi etkinleştirir.
- Kullanıcıların yalnızca kendi kayıtlarına erişmesini sınırlar.
- API için `authenticated` rolüne gerekli tablo izinlerini verir.

Supabase Data API ayarlarında otomatik tablo gösterimi kapalıysa, kullanılan tabloları Dashboard'daki **Data API** bölümünden açıkça expose etmeniz gerekir.

## 4. Hugging Face

Hugging Face'de Inference Providers erişimi olan bir fine-grained token oluşturun ve yalnızca sunucu ortamında `HF_TOKEN` olarak tanımlayın.

Uygulama, OpenAI-uyumlu `https://router.huggingface.co/v1/chat/completions` uç noktasını kullanır.

Uygulama sağlayıcı hata gövdelerini kullanıcıya veya normal sunucu hata çıktısına taşımamak üzere hata mesajlarını sınırlar. Geçici 408/429/5xx hatalarında sınırlı yeniden deneme uygulanır ve üretim uzunluğu MVP veri sınırına uygun tutulur.

## 5. Lokal çalıştırma

```powershell
npm run typecheck
npm run dev
```

Sonra:

```
http://localhost:3000
```

Health check:

```
http://localhost:3000/api/health
```

## 6. Vercel dağıtımı

Vercel'de GitHub repository'sini içe aktarın ve **Root Directory** olarak:

```
dijital-ikiz-mvp/dijital-ikiz-mvp
```

seçin.

Vercel Environment Variables:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
HF_TOKEN
HF_MODEL
```

Üretim, preview ve development ortamları için gerekli değişkenleri ekleyin.

### GitHub Actions üzerinden dağıtım

`.github/workflows/vercel-deploy.yml`, GitHub Actions üzerinden manuel/otomatik üretim dağıtımı içindir. Bu workflow'un dağıtımı gerçekten başlatması için GitHub repository ayarlarında **Settings → Secrets and variables → Actions** altında şu iki secret tanımlı olmalıdır:

- `VERCEL_TOKEN`: Vercel hesabında oluşturulan erişim token'ı.
- `VERCEL_ORG_ID`: Vercel projesinin bulunduğu takımın Vercel Team ID'si.

Token'ı kaynak koda, issue'lara, loglara veya sohbet mesajlarına yazma. Workflow eksik secret'ları tespit ederse dağıtımı atlar ve GitHub Actions özeti içinde nedenini gösterir. Bu durumda workflow'un genel sonucu yeşil görünebilse bile üretim güncellenmiş değildir. Secret'lar kaydedildikten sonra **Actions → Vercel Deploy → Run workflow** ile manuel çalıştırma yapılabilir.

Bu GitHub Actions yolu ile Vercel Dashboard'daki Git bağlantısı birbirinden ayrı dağıtım yöntemleridir. Vercel projesi ve repo bağlantısının gerçekten doğru olduğundan emin olun; bir build'in başarılı olması tek başına uygulamanın üretime yayımlandığını kanıtlamaz.

## 7. Semantic Memory Engine

Kişiselleştirilmiş koşulda kullanıcıdan açıkça çıkarılabilen sınırlı tercih ve iletişim tercihleri, tam konuşma metni yerine türetilmiş kısa kayıtlar olarak `memory_items` tablosunda tutulur. Kayıtlar 384 boyutlu embedding ile saklanır ve yalnızca aynı kullanıcının RLS kapsamındaki kayıtları RPC üzerinden cosine similarity ile geri çağrılır. Bellek üretimi veya embedding servisi başarısız olursa sohbet akışı bozulmaz; bellek katmanı atlanır.

**Aşama 5.1 güvenlik ve yaşam döngüsü:** Geri getirilen bellek system prompt'a gömülmez; ayrı bir kullanıcı-rolü referans verisi olarak JSON biçiminde aktarılır ve sistem talimatları belleğin içindeki metnin güvenilmeyen veri olduğunu açıkça söyler. JSON serileştirme, bellekteki satır sonlarının ve bölüm işaretleyicilerinin prompt yapısını bozmasını önler. Aday çıkarma ve prompt'a ekleme aşamalarında talimatları geçersiz kılma veya gizli bilgileri isteme türü içerikler reddedilir.

Bellekler 180 gün boyunca etkin kullanılmadığında temizlenir ve hesap başına en yeni 50 kayıtla sınırlandırılır. Temizlik yalnızca doğrulanmış oturumun RLS kapsamındaki kayıtlarında çalışır; veri silme uç noktası belleği de siler. Eşzamanlı yazmalarda sınır kısa süreli aşılırsa sonraki kişiselleştirilmiş bellek işlemi fazla kayıtları temizler. Sağlık, kimlik, finans, kimlik doğrulama sırrı ve benzeri yüksek riskli terimler içeren adaylar temel çıkarıcı tarafından kaydedilmez.

## 8. MVP kapsamı

Mevcut sürüm:

- kullanıcı kayıt/giriş akışı,
- kalıcı sohbet geçmişi,
- kullanıcıya ait dijital ikiz profil kaydı,
- VAD için deneysel baseline göstergeleri,
- Big Five için deneysel baseline göstergeleri,
- ifade/üslup göstergeleri,
- varyanta göre ayrıştırılmış sohbet geçmişi,
- kişiselleştirilmiş ve genel koşulların profil durumunu karıştırmaması,
- veri silme,
- kullanıcı başına temel istek sınırlama,
- istek gövdesi ve sohbet geçmişi boyut sınırları,
- mutasyon yapan tarayıcı API'lerinde same-origin kontrolü,
- güvenlik HTTP başlıkları,
- sistem talimatlarını ve güvenilmeyen konuşma verisini ayırmaya yönelik temel prompt güvenliği,
- 1–5 geri bildirim ve varyant doğrulaması

sağlar.

## 9. Bilimsel durum

Bu MVP'deki duygu, kişilik ve üslup çıkarımı **heuristic/baseline** yaklaşımıdır. Bu nedenle henüz rapordaki %75 doğruluk hedefinin sağlandığı iddia edilmemelidir.

TÜBİTAK'ın Ar-Ge aşaması için sonraki adımlar:

1. etik ve izinleri belirlenmiş Türkçe veri kümesi oluşturma,
2. veri ön işleme ve etiketleme,
3. gerçek duygu modeli eğitimi ve F1/accuracy/precision/recall ölçümü,
4. Big Five kişilik modelinin etiketli veride eğitilmesi,
5. üslup özelliklerinin ve embedding tabanlı temsilin karşılaştırılması,
6. kişiselleştirme katmanının kontrollü deneylerle değerlendirilmesi,
7. kullanıcı değerlendirmesi ve A/B testi.

Deney yapılmadan sonuçlar bilimsel başarı olarak raporlanmamalıdır.

## 10. Güvenlik ve gizlilik

Uygulama kullanıcı konuşmalarını, geri bildirimlerini ve çıkarılan profil verilerini saklar. Kullanıcı arayüzünden kendi sohbet ve profil verilerini silebilir.

Koruma katmanları arasında Supabase RLS, server-side kullanıcı doğrulaması, same-origin kontrolleri, girdi/çıktı boyut sınırları, process-local istek sınırlama ve güvenlik HTTP başlıkları bulunur.

**Önemli:** process-local rate limiter, sunucusuz ortamlarda instance bazlı olduğu için dağıtık bir kötüye kullanım önleme sistemi değildir. Üretim trafiği büyüdüğünde merkezi bir rate-limit katmanına geçirilmelidir.

Proje çocuklar veya psikolojik destek gibi alanlarda gerçek kullanıcı çalışmasına geçmeden önce uygun etik, ebeveyn/onam, veri koruma ve uzman denetimi süreçleri ayrıca değerlendirilmelidir.

## 11. Proje raporu ile eşleştirme

PDF'deki üç ana modülün MVP karşılığı:

- **Giriş Verisi Analiz Modülü:** `lib/twin.ts`
- **Dijital İkiz profili/veritabanı:** `supabase/schema.sql` ve `/api/chat`
- **Dijital İkiz sohbet motoru:** `lib/huggingface.ts` ve `/api/chat`

MVP, rapordaki beş basamağın tamamlanmış bilimsel versiyonu değil; uygulama mimarisini ve ilk çalışan sohbet döngüsünü doğrulayan başlangıç sürümüdür.

## Yayına Alma

Vercel ana Next.js uygulamasını çalıştırmak, InfinityFree ise yalnızca statik tanıtım sayfasını barındırmak için kullanılır. GitHub Actions iş akışları gerekli Secrets olmadan dağıtım adımını atlar; bu durumda bir iş akışının başarılı olması sitenin yayımlandığını kanıtlamaz.

Kurulum adımları, gereken environment variables ve GitHub Secrets için [Vercel ve InfinityFree yayına alma kontrol listesine](docs/hosting-setup.md) bakın.
