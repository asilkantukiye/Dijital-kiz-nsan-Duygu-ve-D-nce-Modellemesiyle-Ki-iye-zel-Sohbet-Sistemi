# Yayına Alma Kontrol Listesi — Vercel ve InfinityFree

Bu depo bir monorepo'dur. Asıl uygulama Next.js uygulamasıdır; InfinityFree klasörü yalnızca statik tanıtım/yönlendirme sayfasıdır.

## Durumun dürüst özeti

GitHub Actions'ta Vercel ve InfinityFree iş akışları mevcut. Son kontrollerde ikisinin de ön kontrolü çalışmış, fakat gerekli GitHub Secrets değerleri boş olduğu için gerçek dağıtım adımı atlanmış. Bu yüzden "Actions success" tek başına sitenin yayımlandığı anlamına gelmez.

## A. Vercel: GitHub deposunu bağla

1. GitHub hesabında **Settings → Applications → Installed GitHub Apps → Vercel → Configure** sayfasını aç.
2. Vercel'in erişebildiği depolar sınırlıysa şu özel depoyu seç ve kaydet: `asilkantukiye/Dijital-kiz-nsan-Duygu-ve-D-nce-Modellemesiyle-Ki-iye-zel-Sohbet-Sistemi`. Depoyu public yapma.
3. Vercel panelinde `dijital-ikiz-insan` projesini aç. **Settings → Git** bölümünde aynı depoya bağla. Proje bir monorepo'da olduğundan **Root Directory** alanını `dijital-ikiz-mvp/dijital-ikiz-mvp` olarak ayarla.
4. Framework Next.js, Node.js 22.x olmalı. Build/install komutlarını elle değiştirmek gerekirse önce uygulama CI'sinin son başarılı sonucunu koru.

## B. Vercel uygulama ortam değişkenleri

Vercel projesinde **Settings → Environment Variables** içinde aşağıdaki anahtarların varlığını kontrol et. Gerekli ortamlar Production, Preview ve Development'dır.

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `HF_TOKEN` — gizli değer; Vercel'e doğrudan gir, sohbete veya GitHub dosyasına yazma.
- `HF_MODEL` — `Qwen/Qwen3-4B-Instruct-2507`
- `UPSTASH_REDIS_REST_URL` — isteğe bağlı Upstash REST endpoint'i (HTTPS); yalnızca Upstash tercih edilirse tanımla.
- `UPSTASH_REDIS_REST_TOKEN` — isteğe bağlı gizli REST token'ı; Upstash seçilirse URL ile birlikte tanımla.
- `RATE_LIMIT_KEY_SALT` — en az 32 rastgele karakter; yalnızca sunucu tarafında tut
- `HEALTHCHECK_TOKEN` — en az 32 rastgele karakter; sadece gizli `/api/health/deep` operasyonel denetimi için
- `HF_EMBEDDING_MODEL` — `intfloat/multilingual-e5-small`

Üretimde dağıtık rate limit zorunludur; Upstash değişkenleri isteğe bağlıdır. Upstash seçilirse URL ve token birlikte tanımlanır. İkisi yoksa Supabase PostgreSQL tabanlı atomik rate-limit migration'ı canlı projede uygulanmış ve `SUPABASE_PRODUCTION_SCHEMA_VERIFIED=true` olarak doğrulanmış olmalıdır. Bu önkoşul sağlanmıyorsa `/api/health` hazır durumunu onaylamaz ve sohbet API'si model çağrısını başlatmaz. Token veya salt değerini GitHub'a/sohbete yazma. Supabase URL ve publishable key'i Supabase projesinin API/Connect ayarlarından al. HF_TOKEN'ı Hugging Face hesabının token ayarlarından üret. Gizli değerleri repoya commit etme.

## C. GitHub Actions için Vercel Secrets

GitHub deposunda **Settings → Secrets and variables → Actions → New repository secret** bölümüne şunları ekle:

- `VERCEL_TOKEN`: Vercel hesabının Settings → Tokens bölümünde oluşturulan token.
- `HEALTHCHECK_TOKEN`: en az 32 rastgele karakter. Aynı değeri GitHub Actions secret ve Vercel **Production** environment variable olarak ayarla; değeri sohbete/repoya koyma.

Takım kapsamı workflow içinde `help-70c6` olarak sabitlenmiştir; `VERCEL_ORG_ID` secret'ı gerekmez. Workflow, `VERCEL_TOKEN` veya `SUPABASE_PRODUCTION_SCHEMA_VERIFIED=true` yoksa gerçek deploy'u atlar. Token'ı sohbet mesajlarına veya repodaki dosyalara yazma.

## D. InfinityFree statik tanıtım sayfası

InfinityFree yalnızca `infinityfree/` klasöründeki statik HTML sayfasını barındıracaktır. Next.js uygulamasını InfinityFree'ye yüklemeye çalışma.

1. InfinityFree hosting hesabında site/domain oluştur. FTP Details bölümünden FTP host/server, username ve password alanlarını bul.
2. GitHub deposunda **Settings → Secrets and variables → Actions → New repository secret** bölümüne şu üç secret'ı ekle:
   - `INFINITYFREE_FTP_SERVER`
   - `INFINITYFREE_FTP_USERNAME`
   - `INFINITYFREE_FTP_PASSWORD`
3. Bunları InfinityFree panelindeki FTP bilgileriyle doldur. Parolayı sohbetten gönderme.
4. Workflow `infinityfree/` klasörünü `/htdocs/` hedefine yükler. Henüz gerçek alan adı ve Vercel adresi doğrulanmadıysa, tanıtım sayfasındaki `YOUR-VERCEL-DOMAIN` yer tutucusunu gerçek adresle değiştir.
5. Secret'lar eklendikten sonra GitHub → Actions → **Deploy InfinityFree landing page** iş akışını aç ve **Run workflow** ile başlat. Günlükte `deploy` işinin `skipped` değil `success` olduğunu ve FTP yükleme adımının tamamlandığını kontrol et.

## Derin sağlık kontrolü

Staged deployment, `/api/health` yapılandırma kontrolüne ek olarak `/api/health/deep` bağlantı kontrolünden geçer. İstek `x-healthcheck-token` başlığında doğru `HEALTHCHECK_TOKEN` ile gönderilir. Bu kontrol Supabase Auth erişimini, Hugging Face token kimliğini ve yapılandırılmış dağıtık rate-limit backend'ini (Upstash Redis `PING` veya Supabase PostgreSQL RPC erişimi) sınar; model inference çalıştırmaz. Dönen gövde yalnızca sağlayıcılar için true/false değerleri içerir. Token'ı hiçbir zaman loglama veya paylaşma.

## Güvenli işlem sırası

Önce Vercel GitHub uygulaması izni ve Vercel ortam değişkenleri, sonra Vercel dağıtımı; gerçek Vercel adresi doğrulandıktan sonra InfinityFree sayfasındaki yer tutucu, FTP secrets ve statik sayfa dağıtımı. Hiçbir erişim anahtarı veya parola repoya commit edilmemelidir.
