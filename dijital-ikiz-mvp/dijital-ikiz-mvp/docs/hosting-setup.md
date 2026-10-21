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
- `HF_EMBEDDING_MODEL` — `intfloat/multilingual-e5-small`

Supabase URL ve publishable key'i Supabase projesinin API/Connect ayarlarından al. HF_TOKEN'ı Hugging Face hesabının token ayarlarından üret. Gizli değerleri repoya commit etme. Değişken eklenince Production deployment'ı yeniden çalıştır.

## C. GitHub Actions üzerinden güvenli Vercel dağıtımı

GitHub deposunda **Settings → Secrets and variables → Actions** bölümünde iki ayrı ayar gerekir.

**Repository secret** — **New repository secret**:
- `VERCEL_TOKEN`: Vercel hesabının Settings → Tokens bölümünde oluşturulan erişim token'ı.

**Repository variable** — **Variables → New repository variable**:
- `SUPABASE_PRODUCTION_SCHEMA_VERIFIED`: sadece doğru Supabase projesinde temel şema, tüm gerekli migration'lar, RLS politikaları ve kritik RPC fonksiyon/izinleri doğrulandıktan sonra tam olarak `true` değerini ver.

Workflow `VERCEL_ORG_ID` secret'ı istemez; takım kapsamı `help-70c6` iş akışında yapılandırılmıştır. Token'ı sohbet mesajlarına, kaynak koduna veya loglara yazma.

Eksik ya da doğrulanmamış önkoşullarda **Vercel Deploy** iş akışının ön kontrolü başarısız olur; doğrulama ve dağıtım adımları çalıştırılmaz, iş akışı yeşil başarı olarak gösterilmez. Supabase projesi `INACTIVE` ise veya veritabanı kontrollerine erişilemiyorsa `SUPABASE_PRODUCTION_SCHEMA_VERIFIED` değişkenini `true` yapma. Bütün kontroller tamamlandıktan sonra **Actions → Vercel Deploy → Run workflow** üzerinden dağıtımı başlat ve üretim sağlık kontrolünü incele.

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

## Güvenli işlem sırası

Önce Vercel GitHub uygulaması izni ve Vercel ortam değişkenleri, sonra Vercel dağıtımı; gerçek Vercel adresi doğrulandıktan sonra InfinityFree sayfasındaki yer tutucu, FTP secrets ve statik sayfa dağıtımı. Hiçbir erişim anahtarı veya parola repoya commit edilmemelidir.
