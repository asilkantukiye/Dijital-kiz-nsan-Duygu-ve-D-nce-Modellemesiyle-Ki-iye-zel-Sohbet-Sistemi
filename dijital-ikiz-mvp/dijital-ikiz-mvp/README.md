# Dijital İkiz İnsan — MVP

TÜBİTAK projesi için geliştirilen ilk çalışan prototiptir. Proje, kullanıcının konuşma örneklerinden deneysel duygu, Big Five kişilik ve ifade/üslup göstergeleri çıkararak kişiselleştirilmiş bir sohbet akışı oluşturmayı amaçlar.

## Mimari

- **Next.js + React + TypeScript:** web uygulaması ve API route'ları
- **Supabase:** kullanıcı kimlik doğrulama, sohbet geçmişi ve dijital ikiz profilinin saklanması
- **Hugging Face Inference Providers:** LLM tabanlı sohbet üretimi
- **Qwen:** ilk MVP üretici model
- **GitHub:** kaynak kodu ve sürüm kontrolü
- **Vercel:** üretim dağıtımı
- **Kaggle:** tek notebook'ta Türkçe polarite eğitimi + Qwen3-4B QLoRA; uygun etiketli veri eklenirse VAD ve Big Five regresyonu

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
npm ci
Copy-Item .env.local.example .env.local
```

`.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
HF_TOKEN=
HF_MODEL=Qwen/Qwen3-4B-Instruct-2507
HF_EMBEDDING_MODEL=intfloat/multilingual-e5-small
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
RATE_LIMIT_KEY_SALT=
# Optional secret for the protected /api/health/deep diagnostic endpoint
HEALTHCHECK_TOKEN=
```

`SUPABASE_SERVICE_ROLE_KEY`, Supabase proje ayarlarındaki service-role/secret server key'dir. Yalnızca server environment (`.env.local` veya Vercel Environment Variables) içinde tutulmalıdır; adının başına `NEXT_PUBLIC_` eklemeyin. **Gizli anahtarları GitHub'a yüklemeyin.** `.env.local` `.gitignore` içindedir.

## 3. Supabase kurulumu

Supabase Dashboard → **SQL Editor** üzerinden `supabase/schema.sql` dosyasını çalıştırın.

Bu SQL:

- `twin_profiles` tablosunu oluşturur.
- `messages` tablosunu oluşturur.
- `message_feedback` tablosunu oluşturur.
- RLS'yi etkinleştirir.
- Kullanıcıların yalnızca kendi kayıtlarına erişmesini sınırlar.
- Oturum açmış kullanıcıların kendi kayıtlarını okumasına/silmesine izin verir; sohbet mesajı ve profil INSERT/UPDATE işlemlerini authenticated rolünden kaldırır.
- `persist_chat_turn_server` RPC'sini yalnız `service_role` için açar. `/api/chat` kullanıcının Supabase oturumunu `auth.getUser()` ile doğrular, `user.id` değerini sunucu tarafında alır ve bu RPC'yi server-only anahtarla çağırır.

Supabase Data API ayarlarında otomatik tablo gösterimi kapalıysa, kullanılan tabloları Dashboard'daki **Data API** bölümünden açıkça expose etmeniz gerekir.

Supabase projesi daha önce kullanıldıysa tam şemayı tekrar uygulamadan önce migration geçmişini kontrol edin. Repodaki timestamp'li migration'ların sırası, salt-okunur doğrulama sorguları, RLS kontrolü ve proje geri yükleme güvenliği için [Supabase migration runbook](supabase/MIGRATION_RUNBOOK.md) belgesini izleyin. GitHub CI sonucu, canlı veritabanında migration uygulanmış olduğunu kanıtlamaz.

### Hesap açmadan kullanım

Arayüz otomatik Supabase anonim oturumu oluşturur; e-posta/şifre ekranı gösterilmez. Supabase Dashboard → **Authentication → Sign In / Providers → Anonymous Sign-Ins** ayarı açık olmalıdır. Anonim oturumdaki sohbet ve profil verileri yalnızca o tarayıcı oturumuna bağlıdır; tarayıcı verileri silinirse anonim kullanıcı hesabı kurtarılamayabilir. Sohbet API'leri ve RLS kullanıcıya özel kalır; ayar kapalıysa uygulama oturum hatası gösterir ve sohbet uçları kapalı kalır.

## 4. Hugging Face

Hugging Face'de Inference Providers erişimi olan bir fine-grained token oluşturun ve yalnızca sunucu ortamında `HF_TOKEN` olarak tanımlayın.

Uygulama, OpenAI-uyumlu `https://router.huggingface.co/v1/chat/completions` uç noktasını kullanır.

Uygulama sağlayıcı hata gövdelerini kullanıcıya veya normal sunucu hata çıktısına taşımamak üzere hata mesajlarını sınırlar. Geçici 408/429/5xx hatalarında sınırlı yeniden deneme uygulanır ve üretim uzunluğu MVP veri sınırına uygun tutulur.

### Üretim sohbet rate-limit yapılandırması

Üretim sohbeti önce geçerli Upstash Redis REST ayarı varsa onu kullanır; yoksa proje zaten kullandığı Supabase PostgreSQL üzerindeki atomik `consume_chat_rate_limit` RPC'sine düşer. Böylece ayrı bir Redis sağlayıcısını zorunlu kılmadan dağıtık limit uygulanabilir. Her iki backend de aynı UTC zaman pencerelerinde kullanıcı başına 20 istek/dakika, proje genelinde 120 istek/dakika ve 1000 istek/gün sınırlarını uygular. Sayaç tablosu RLS ile korunur; doğrudan erişim yalnızca `service_role` içindir ve RPC yalnızca sunucudan çağrılır.

`RATE_LIMIT_KEY_SALT` her dağıtım ortamında en az 32 karakterlik benzersiz gizli değer olmalıdır; kullanıcı kimlikleri Redis anahtarına veya DB sayacına ham biçimde gönderilmez, HMAC-SHA256 özeti kullanılır. Üretim ortamında rate-limit backend'i, salt veya server key yapılandırması eksik/erişilemezse sohbet API'si modele istek göndermeden `503` döndürür. Upstash seçilirse aşağıdaki iki ek değişken kullanılır:

- `UPSTASH_REDIS_REST_URL`: HTTPS ile başlayan Upstash REST endpoint'i (`*.upstash.io`).
- `UPSTASH_REDIS_REST_TOKEN`: Upstash panelinden alınan REST token'ı; yalnızca sunucu ortamında tut.

Bu sınırlar başlangıç mühendislik değerleridir, kesin bir parasal harcama tavanı değildir. Geliştirme ortamında tüm dağıtık backend ayarları boşken yalnızca test amacıyla süreç içi sayaç kullanılabilir; bu sayaç dağıtık koruma değildir.

### Üretim tarayıcı güvenliği

Üretimde her proxy isteği yeni bir nonce tabanlı Content Security Policy (CSP) alır; unsafe-eval etkinleştirilmez. Tarayıcının dış bağlantıları Supabase HTTPS ve Realtime WebSocket adresleriyle sınırlıdır; Hugging Face ve Upstash yalnızca sunucudan çağrılır. HSTS yalnızca production build'inde etkinleştirilir. CSP nonce'ları istekler arasında yeniden kullanılmaz.

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
SUPABASE_SERVICE_ROLE_KEY
HF_TOKEN
HF_MODEL
HF_EMBEDDING_MODEL
RATE_LIMIT_KEY_SALT
HEALTHCHECK_TOKEN
# Optional only when Upstash is selected:
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
```

Üretim, preview ve development ortamları için gerekli değişkenleri ekleyin.

### GitHub Actions üzerinden dağıtım

`.github/workflows/vercel-deploy.yml`, yalnızca **elle başlatılan** üretim dağıtımı içindir. Dağıtım için bir secret ve ayrı bir repository variable gerekir:

- `VERCEL_TOKEN` secret'ı: Vercel hesabında oluşturulan erişim token'ı.
- `HEALTHCHECK_TOKEN` secret'ı: en az 32 rastgele karakterlik gizli değer. Aynı değeri Vercel Production environment variable olarak da tanımla; yalnızca /api/health/deep için kullanılır.
- `SUPABASE_PRODUCTION_SCHEMA_VERIFIED` repository variable'ı: yalnızca doğru Supabase projesinde temel şema ve tüm gerekli migration'lar uygulandıktan; RLS politikaları ve gereken RPC fonksiyon/izinleri runbook'a göre doğrulandıktan sonra tam olarak `true` değerine ayarlanır.

Takım kapsamı workflow içinde `help-70c6` olarak yapılandırılmıştır; ayrıca `VERCEL_ORG_ID` secret'ı oluşturman gerekmez. Token'ı kaynak koda, issue'lara, loglara veya sohbet mesajlarına yazma. GitHub repository ayarlarında **Settings → Secrets and variables → Actions → New repository secret** yoluyla `VERCEL_TOKEN` ve `HEALTHCHECK_TOKEN` ekle; aynı sayfadaki **Variables → New repository variable** yoluyla migration onay değişkenini oluştur. HEALTHCHECK_TOKEN üretmek için terminalde `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"` çalıştırıp aynı gizli değeri GitHub secret ve Vercel Production değişkenine gir. Değeri sohbete, issue'ya veya repoya yazma. Proje Supabase tarafında **INACTIVE** görünüyorsa veya migration'ın uygulandığı doğrulanamıyorsa değişkeni `true` yapma ve dağıtımı başlatma. [Supabase migration runbook](supabase/MIGRATION_RUNBOOK.md) doğru projeyi doğrulama, migration geçmişini kontrol etme ve fonksiyon izinlerini denetleme adımlarını açıklar.



Üretim dağıtım işi `production` GitHub Environment'ını kullanır. **Settings → Environments → production** altında deployment branch kısıtını yalnızca `main` ile sınırlandırın ve hesab/repo planınız destekliyorsa bağımsız bir Required reviewer ile self-review engelini etkinleştirin. Ortam koruması ayarlanmamışsa `environment: production` tek başına onay kapısı oluşturmaz. CLI sürümü `63.1.2` olarak sabittir; `VERCEL_TOKEN` yalnızca adım ortam değişkeni olarak kullanılır, komut satırı argümanına veya kaynak koda yazılmaz.

### Üretim dağıtımının sırası

1. Workflow yalnızca elle başlatılır ve yalnızca `main` dalından ilerler.
2. `SUPABASE_PRODUCTION_SCHEMA_VERIFIED=true` olmadan preflight başarısız olur. Bu değişkeni yalnızca doğru Supabase projesindeki temel şema, gereken tüm migration'lar, RLS politikaları ve kritik RPC izinleri gerçek sorgularla doğrulandıktan sonra ayarlayın. Dosya adı ile canlı migration sürümü eşleşmiyorsa önce geçmişi uzlaştırın; bu değişkeni yalnızca CI yeşil olduğu için `true` yapmayın.
3. Tam Python/ML doğrulaması, uygulama birim testleri, TypeScript kontrolü ve üretim build'i geçmelidir.
4. Staging işi Vercel Production ortamında gereken değişken adlarını kontrol eder: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `HF_TOKEN`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `RATE_LIMIT_KEY_SALT` ve `HEALTHCHECK_TOKEN`. Kontrol değerleri loglamaz; eksik anahtar adlarını raporlayıp dağıtımı durdurur.
5. Vercel Production ayarları çekilir, aynı Production ayarlarıyla build alınır ve `vercel deploy --prebuilt --prod --skip-domain` kullanılarak deployment önce alan adı atanmadan hazırlanır.
6. Hazırlanan deployment'ın `/api/health` endpoint'i geçerli JSON, `ok: true` ve `ready: true` döndürmelidir. Ancak bu kontrol yapılandırma ve readiness koşullarını doğrular; gerçek model çıkarımının başarılı olduğunu tek başına kanıtlamaz; Supabase veri yazımını veya iki kullanıcı arasındaki izolasyonu da test etmez.
7. Staged deployment'ın `/api/health/deep` endpoint'i yalnızca `x-healthcheck-token` başlığında doğru gizli token gönderildiğinde bağlantı denetimi yapar. Supabase Auth, Hugging Face token kimliği ve Upstash Redis `PING` kontrol edilir; model çıkarımı çağrılmaz ve gizli değerler yanıtta dönmez. Herhangi bir denetim başarısızsa workflow terfi ettirmez.
8. Staged yapılandırma ve tüm upstream sağlık kontrolleri başarılı olduktan sonra ayrı `promote` işi `production` GitHub Environment kapısına gelir. Terfi sonrası `https://dijital-ikiz-insan.vercel.app/api/health` alan adı tekrar kontrol edilir.

Önkoşullardan biri eksikse workflow hata verir ve dağıtım yapmaz; bu durumda üretim güncellenmiş değildir. GitHub CI testlerinin yeşil olması, gerçek Supabase veritabanına migration uygulandığını kanıtlamaz. Vercel Git entegrasyonu önizleme deployment'ları oluşturabilir; uygulama kökündeki `vercel.json`, `main` dalından otomatik Git deployment'ını kapatır (`git.deploymentEnabled.main: false). Böylece `main` dalına merge tek başına üretim terfisi başlatmamalıdır. Üretim dağıtımı yalnızca GitHub Actions **Vercel Deploy** workflow'u üzerinden yapılmalıdır.

## 7. Semantic Memory Engine

Kişiselleştirilmiş koşulda kullanıcıdan açıkça çıkarılabilen sınırlı tercih ve iletişim tercihleri, tam konuşma metni yerine türetilmiş kısa kayıtlar olarak `memory_items` tablosunda tutulur. Kayıtlar 384 boyutlu embedding ile saklanır ve yalnızca aynı kullanıcının RLS kapsamındaki kayıtları RPC üzerinden cosine similarity ile geri çağrılır. Bellek üretimi veya embedding servisi başarısız olursa sohbet akışı bozulmaz; bellek katmanı atlanır.

**Aşama 5.1 güvenlik ve yaşam döngüsü:** Geri getirilen bellek system prompt'a gömülmez; ayrı bir kullanıcı-rolü referans verisi olarak JSON biçiminde aktarılır ve sistem talimatları belleğin içindeki metnin güvenilmeyen veri olduğunu açıkça söyler. JSON serileştirme, bellekteki satır sonlarının ve bölüm işaretleyicilerinin prompt yapısını bozmasını önler. Aday çıkarma ve prompt'a ekleme aşamalarında talimatları geçersiz kılma veya gizli bilgileri isteme türü içerikler reddedilir.

Bellekler için hedef saklama kuralı 180 günlük etkin olmama süresi ve hesap başına en fazla 50 kayıttır; ancak şu an 180 günlük temizlik arka planda zamanlanmış bir iş değildir. Temizlik, o hesap yeni bir kişiselleştirilmiş mesaj gönderdiğinde bellek geri çağırma/yazma yolunda çalışır ve yalnızca doğrulanmış oturumun RLS kapsamındaki kayıtlarını işler. Kullanıcı hiç geri dönmezse yalnızca 180 günün geçmesi nedeniyle bellek kayıtları otomatik silinmez; bunun için kullanıcıya ait açık veri silme işlemi kullanılabilir. Bu belleğe özgü kural sohbet geçmişine otomatik silme süresi olarak uygulanmaz. Eşzamanlı yazmalarda 50 kayıt sınırı kısa süreli aşılırsa sonraki kişiselleştirilmiş bellek işlemi fazla kayıtları temizler. Sağlık, kimlik, finans, kimlik doğrulama sırrı ve benzeri yüksek riskli terimler içeren adaylar temel çıkarıcı tarafından kaydedilmez.

## 8. MVP kapsamı

Mevcut sürüm:

- hesap açma ekranı olmadan anonim oturum; sohbet API'lerinde doğrulanmış Supabase kullanıcı kimliği,
- kalıcı sohbet geçmişi,
- kullanıcıya ait dijital ikiz profil kaydı,
- VAD için deneysel baseline göstergeleri,
- Big Five için deneysel baseline göstergeleri,
- ifade/üslup göstergeleri,
- varyanta göre ayrıştırılmış sohbet geçmişi,
- kişiselleştirilmiş ve genel koşulların profil durumunu karıştırmaması,
- veri silme,
- üretimde dağıtık kullanıcı/dakika ve proje-geneli dakika/UTC-günü rate-limit, geliştirmede süreç içi fallback,
- istek gövdesi ve sohbet geçmişi boyut sınırları,
- mutasyon yapan tarayıcı API'lerinde same-origin kontrolü,
- güvenlik HTTP başlıkları,
- sistem talimatlarını ve güvenilmeyen konuşma verisini ayırmaya yönelik temel prompt güvenliği,
- 1–5 geri bildirim ve varyant doğrulaması

sağlar.

## 9. Bilimsel durum

Bu MVP'deki duygu, kişilik ve üslup çıkarımı **heuristic/baseline** yaklaşımıdır. Bu nedenle henüz rapordaki %75 doğruluk hedefinin sağlandığı iddia edilmemelidir.

Kaggle eğitim hattı tek notebook'ta Türkçe duygu polaritesi sınıflandırmasını ve Qwen3-4B QLoRA talimat ince ayarını çalıştırır. VAD ve Big Five görevleri yalnızca hedeflerine uygun etiketli CSV'ler eklenirse çalışır. Polarite etiketleri VAD veya kişilik puanı olarak kullanılmaz; genel talimat verisi de kişiye özel dijital ikiz etiketi değildir.

TÜBİTAK Ar-Ge için kalan işler:

1. VAD için doğrulanmış 0–1 etiketli Türkçe örnekler ve etiketleyiciler arası uyum.
2. Big Five için katılımcı onamı ve doğrulanmış kişilik ölçeği skorları.
3. Eğitilmiş modelleri gerçek uygulama akışına bağlama ve baseline ile karşılaştırma.
4. Kişiselleştirilmiş/genel sohbet için kör insan değerlendirmesi ve önceden belirlenmiş A/B protokolü.
5. Üretilen gerçek test metriklerini, sınırlılıkları ve veri izinlerini proje raporuna ekleme.

Deney yapılmadan sonuçlar bilimsel başarı olarak raporlanmamalıdır.

## 10. Güvenlik ve gizlilik

Uygulama kullanıcı konuşmalarını, geri bildirimlerini ve çıkarılan profil verilerini saklar. Kullanıcı arayüzünden kendi sohbet ve profil verilerini silebilir.

Koruma katmanları arasında Supabase RLS, server-side kullanıcı doğrulaması, same-origin kontrolleri, girdi/çıktı boyut sınırları, üretimde dağıtık Upstash rate-limit ve güvenlik HTTP başlıkları bulunur.

**Önemli:** üretim limit kararı Upstash Redis REST üzerinde atomik Lua komutuyla verilir; process-local sayaç yalnızca Upstash yapılandırmasının tamamen boş olduğu geliştirme ortamında kullanılabilir. Üretimde eksik yapılandırma veya Redis hatası, ücretli inference'ı kapatır.

Proje çocuklar veya psikolojik destek gibi alanlarda gerçek kullanıcı çalışmasına geçmeden önce uygun etik, ebeveyn/onam, veri koruma ve uzman denetimi süreçleri ayrıca değerlendirilmelidir.

## 11. Proje raporu ile eşleştirme

PDF'deki üç ana modülün MVP karşılığı:

- **Giriş Verisi Analiz Modülü:** `lib/twin.ts`
- **Dijital İkiz profili/veritabanı:** `supabase/schema.sql` ve `/api/chat`
- **Dijital İkiz sohbet motoru:** `lib/huggingface.ts` ve `/api/chat`

TÜBİTAK raporundaki beş basamağın mevcut kod karşılıkları, araştırma eksikleri ve kabul ölçütleri için [Ar-Ge yol haritasına](ml/PROJECT_RESEARCH_PLAN.md) bakın.

MVP, rapordaki beş basamağın tamamlanmış bilimsel versiyonu değil; uygulama mimarisini ve ilk çalışan sohbet döngüsünü doğrulayan başlangıç sürümüdür.

## Yayına Alma

Vercel ana Next.js uygulamasını çalıştırmak, InfinityFree ise yalnızca statik tanıtım sayfasını barındırmak için kullanılır. GitHub Actions iş akışları gerekli Secrets olmadan dağıtım adımını atlar; bu durumda bir iş akışının başarılı olması sitenin yayımlandığını kanıtlamaz.

Kurulum adımları, gereken environment variables ve GitHub Secrets için [Vercel ve InfinityFree yayına alma kontrol listesine](docs/hosting-setup.md) bakın.
