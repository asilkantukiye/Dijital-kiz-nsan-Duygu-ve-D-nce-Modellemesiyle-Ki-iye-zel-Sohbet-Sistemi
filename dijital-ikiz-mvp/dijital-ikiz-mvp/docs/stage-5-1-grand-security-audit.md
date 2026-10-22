# Dijital İkiz İnsan — Stage 5.1 Büyük Güvenlik ve Yayına Hazırlık Denetimi

**Denetim tarihi:** 22 Ekim 2026  
**İncelenen ana dal commit'i:** `c2d9e58f51616842c0fc39645b4ba1cf398895f8`  
**Kapsam:** Uygulama/API, bellek çıkarma ve geri çağırma, SQL migration/RLS/RPC, Next.js güvenlik başlıkları, CI/production workflow'u, ML veri/etik yönergeleri.  
**Karar:** **NO-GO — Stage 6 production promotion onaylanmıyor.**

> Bu belge, kaynak kod ve CI yapılandırmasının statik incelemesidir. Canlı Supabase veritabanına bağlı kabul testi, üretim yük testi, gerçek Hugging Face çıkarım testi veya hukukî uygunluk görüşü değildir. Kaynak kodda “güvenli” görünen bir kontrol, canlı ortamda uygulandığını veya üretim davranışını tek başına kanıtlamaz.

## Yönetici kararı ve kapsam sınırı

Mevcut proje; sunucu tarafı kimlik doğrulaması, RLS, üç kritik veri-işleme RPC'sinde `SECURITY INVOKER`, sohbet turunun profil + iki mesaj olarak transaction içinde yazılması, kontrollü bellek bağlamı ve CI'da PostgreSQL entegrasyon testleri gibi yararlı kontrol katmanlarına sahip. Ancak bunlar Stage 6 için yeterli değildir.

Canlı ortam tarafında iki bağımsız engel doğrulanmıştı: Supabase projesi `INACTIVE` durumundaydı; migration geçmişini okuma girişiminde `postgres` parolası doğrulanmadı. Ayrıca GitHub Vercel workflow'u `VERCEL_TOKEN` ve doğrulanmış migration değişkeni yokken preflight aşamasında dağıtımı durduruyor. Bu koruma **atlanmamalı**.

Aşağıdaki sınıflandırmada:
- **Doğrulanmış bulgu:** Kaynakta veya workflow'da doğrudan görülen durum.
- **Risk/kanıtlanmamış:** Makul arıza biçimi; ancak canlı yük testi/telemetri olmadan gerçekleştiği söylenemez.
- **Gereken kanıt:** Bulguyu kapatmak için gereken otomatik test, operatör kontrolü veya canlı kabul testi.

## Grand Defect Matrix

| ID | Alan | Önem | Kanıt durumu | Stage 6 öncesi şart |
|---|---|---|---|---|
| G-01 | Canlı DB/migration durumu | **Bloklayıcı** | Supabase `INACTIVE`; migration geçmişi parola hatası nedeniyle doğrulanmadı | Doğru proje, migration sırası, RLS/RPC/izinler ve iki kullanıcılı E2E |
| G-02 | 180 günlük otomatik saklama | **Yüksek** | Şu an yalnızca lazy pruning var; arka plan işi yok | Onaylı retention politikası + `pg_cron`/eşdeğer + job izleme + yaşlandırılmış test |
| G-03 | Dağıtık rate limit | **Yüksek** | `Map` süreç/instance yerelinde | Ortak atomik limit servisi + üretimde fail-closed davranış + maliyet korumaları |
| G-04 | Content Security Policy | **Yüksek** | `next.config.ts` içinde CSP yok | Nonce tabanlı CSP entegrasyonu ve tarayıcı regresyon testleri |
| G-05 | Production workflow güvenliği | **Yüksek** | Denetim tabanında `vercel@latest`, komut satırında token argümanı ve `main` push tetiklemesi var | Sabit CLI, token sadece env, yalnızca manuel tetikleme, Environment koruma ayarları |
| G-06 | CI migration kapsamı | **Yüksek** | Runbook 8 migration listeliyor; CI SQL zinciri bunların yalnızca 6'sını çalıştırıyor | Baştan sona 8 migration'ı temiz PostgreSQL+pgvector üzerinde uygulayan test |
| G-07 | Tercih belleği yarışları | **Orta/Yüksek** | Çatışma planı uygulama tarafında çıkarılıyor; RPC yalnızca gelen ID listesini uygular | DB içinde kilitli/canonical topic conflict çözümü ve eşzamanlı test |
| G-08 | Tekrarlanan chat isteği/idempotency | **Orta/Yüksek** | UI tek-flight koruması var; RPC her başarılı çağrıda yeni çift yazar | İstek kimliği, idempotency kaydı ve belirsiz istemci retry testi |
| G-09 | Health/readiness anlamı | **Orta** | `/api/health` yapılandırma varlığını ölçüyor, gerçek upstream erişimini değil | Liveness/readiness/deep dependency testlerini ayrı tanımla |
| G-10 | Prompt injection semantiği | **Orta** | Unicode biçim kontrolü için iyileştirme var; filtre hâlâ kural tabanlı | Adversarial red-team seti, model tabanlı tool erişiminin olmaması ve açık sınırlamalar |
| G-11 | Bilimsel geçerlilik | **Bloklayıcı bilimsel iddia** | VAD/Big Five/üslup göstergeleri heuristic; veri kaynağı/etiket/gerçek koşu kanıtı eksik | Grup bazlı split, etiketleyici uyumu, sealed test, metrik ve model kartı |
| G-12 | Bağımlılık/supply chain | **Orta** | Lockfile ana dala eklendi; Vercel CLI sabitlemesi ayrı incelemede | Kilitli kurulum, sabit CLI, bağımlılık denetimi ve sürüm değişikliklerinde CI |

## 1. Database consistency, transaction atomicity ve rollback

### 1.1 Gerçekte ne atomik?

`supabase/migrations/20261020200000_atomic_chat_turn_persistence.sql` içindeki `persist_chat_turn`, aynı PostgreSQL fonksiyon çağrısında:
1. personalized koşulda profil upsert'i,
2. kullanıcı mesajı insert'i,
3. asistan mesajı insert'i
gerçekleştirir. PL/pgSQL fonksiyonu çağrıldığı SQL transaction'ına katılır; ikinci mesaj insert'i hata verirse fonksiyonun ilk yazımları da rollback olur. `SECURITY INVOKER`, çağıranın grant/RLS sınırlarını korumak üzere tercih edilmiş. Mevcut SQL entegrasyon testi rollback durumunu da test ediyor.

**Önemli ayrım:** Qwen/Hugging Face çağrısı bu transaction'ın içinde değil. `app/api/chat/route.ts` önce model yanıtını üretir, daha sonra `persist_chat_turn` RPC'sini çağırır. Bu, yavaş model isteği boyunca DB transaction/lock tutmama açısından doğru bir tasarım. Model çağrısı başarısız olursa bu tur DB'ye yazılmaz. Fakat model başarılı cevap üretip ağ bağlantısı sonuç istemciye dönmeden kesilirse, kullanıcı aynı mesajı yeniden gönderdiğinde ikinci bir ücretli çıkarım ve ikinci kayıt çifti oluşabilir: **transaction atomicity, HTTP isteğinin exactly-once çalışmasını garanti etmez.**

### 1.2 Embedding timeout, retry ve kısmi kayıt

`lib/huggingface.ts` embedding çağrısını zaman aşımı ve sınırlı tekrar denemeyle sınırlar. `lib/memory.ts`, en fazla 4 bellek adayının embedding'ini paralel ister. Bir kişiselleştirilmiş tur için en kötü durumda birden fazla harici çağrı/yeniden deneme oluşabilir. Sohbet turu daha önce kaydedildiği için embedding başarısızlığı sohbet çiftini rollback etmez; `route.ts` bellek yazma hatasını yakalayıp sohbet yanıtını korur. Bu, kullanılabilirlik için makul; ancak operatör açısından “sohbet başarılı, bellek yazımı atlandı” metriği yoksa sessiz kalite düşüşüne dönüşebilir.

**Pool exhaustion konusunda kanıt:** Kaynakta DB havuzunun tükendiğine dair telemetri yok. Bunu olmuş gibi raporlamak doğru olmaz. Dış API çağrılarının DB transaction'ı dışında yapılması riski azaltıyor. Gerçek eşzamanlı kullanıcı sayısı, Supabase pooler ayarı, RPC gecikme p95/p99 ve bağlantı wait değerleri için yük testi gerekir.

### 1.3 `match_memory_items` ve RLS

`20261008202104_stage5_memory_engine.sql` içindeki `match_memory_items`:
- `SECURITY INVOKER`,
- `memory_items.user_id = (select auth.uid())` filtresi,
- tablo RLS politikası,
- `anon` ve `PUBLIC` için execute revoke, `authenticated` için execute grant
kullanıyor. Bu kodda açık bir doğrudan tenant-sızıntısı görünmüyor; testler de User B'nin User A belleğini okuyamamasını ve RPC'nin yalnızca kendi belleklerini döndürmesini kontrol ediyor.

RPC cursor/pagination kullanmıyor; sonuç sayısı 20'yle sınırlanıyor. Dolayısıyla “üst üste binen pagination cursor'ı” bu fonksiyonun mevcut doğrudan saldırı yolu değildir. Yine de HNSW indeksinin tenant filtreli sorgularda performansı/geri çağırma kalitesi büyük veri hacmiyle benchmark edilmemiş. Bu, mevcut koddaki kanıtlanmış cross-tenant veri sızıntısı değil; ölçek büyüyünce ölçülmesi gereken performans/recall riski.

### 1.4 Bellek tercih güncellemesinde yarış koşulu

`20261021211000_stage5_atomic_memory_preference_update.sql` tek çağrı içinde seçilmiş `p_keep_id` satırını güncelleyip çağıranın `p_duplicate_ids` listesindeki aynı-kullanıcı preference kayıtlarını siler. Bu, gönderilen planın atomikliğini sağlar; ama çatışma planı `planPreferenceReplacement` üzerinden uygulama tarafında ve RPC'den önce hesaplanıyor. İki istek şu sırayla çalışabilir:
1. A ve B aynı eski tercih kümesini okur.
2. Her biri eski anlık görüntüye dayalı bir keep/delete listesi üretir.
3. A önce commit eder.
4. B eski ID listesi ile çalışır; yeni eklenmiş bir çatışmalı satır listede olmayabilir.

Aynı `p_keep_id` güncellemelerinde PostgreSQL satır kilidi yazıcıları sıraya sokar; bu faydalıdır ama stale duplicate listesi problemini bütünüyle çözmez. Ayrıca aynı konu için iki farklı içerik ilk kez eşzamanlı gelirse, JS çatışma planı yokken ayrı `user_id, content` kayıtları olarak oluşabilir. Bu durumda unique index farklı içerikleri engellemez.

**Kalıcı çözüm önerisi:** Konu anahtarını (örn. sugar+coffee) DB'de saklayan canonical alan ve aynı kullanıcı/konu için tekil kısıt; konuyu baz alan transaction-level lock; ve satırları RPC içinde tekrar okuyup çatışmayı sunucuda hesaplama. Bu migration, eski tercih kayıtlarını nasıl key'leyeceği belirlenmeden canlı DB'ye uygulanmamalı. Yalnızca `pg_advisory_xact_lock` ekleyip JS planını olduğu gibi bırakmak yarışın bütün biçimlerini çözmez.

### 1.5 Chat RPC yetkilendirmesi ve idempotency

`persist_chat_turn` doğrudan `authenticated` rolüne açık; fonksiyon kendi kullanıcı kimliğiyle çalışıyor ve çapraz kullanıcı kaydını engelliyor. Ancak oturum açmış bir istemci API route'unu çağırmadan RPC'yi doğrudan da çağırabilir. Bu, başka kullanıcıya yazma erişimi vermez; fakat uygulama katmanındaki process-local rate limit'i DB RPC çağrılarına uygulamaz. Chat API masrafı için asıl kritik yol model endpoint'i; yine de DB write/rpc abuse için ayrı DB-side quota veya server-only yazma mimarisi değerlendirilmelidir.

`persist_chat_turn` bir idempotency anahtarı almıyor. Tek-flight UI kontrolü hızlı çift tıklamayı önler; ağ belirsizliği, yeniden gönderim ve farklı serverless instance'lar arasındaki yarışları engellemez. Çözüm yalnızca DB'de unique `request_id` eklemek değil: model çağrısından önce kısa transaction'la bir idempotency/lease kaydı almak, harici çağrıyı transaction dışında yapmak ve tamamlanan yanıtı bu kayıtla bağlamak gerekir. Böylece aynı anahtara gelen eşzamanlı çağrılar ikinci inference'ı mümkün olduğunca engeller; provider çağrısı ile DB commit'i arasında mutlak exactly-once garantisi yine verilemez.

## 2. 180-day retention ve GDPR/KVKK

### 2.1 Doğrulanmış boşluk

`lib/memory.ts` içindeki `pruneMemoryLifecycle`, 180 günlük etkin olmama ve kişi başına 50 kayıt kuralını `retrieveMemories` ve `persistMemories` sırasında uygular. `README.md` ile `app/privacy/page.tsx` bunu arka planda zamanlanan bir iş olarak sunmuyor; kullanıcı hiç dönmezse yalnızca sürenin geçmesi belleği silmez. Dolayısıyla hedef politika “180 gün sonra silinmiş olmalı” anlamındaysa uygulamanın mevcut lazy cleanup'ı tek başına yeterli değil. Bunun hukukî ihlal olduğuna ilişkin nihai karar, yayımlanmış bildirimin gerçek ifadesi, veri işleme amacı ve uygulanabilir KVKK/GDPR yükümlülükleri görülmeden verilemez; ama teknik-politika uyumsuzluğu riski gerçektir.

### 2.2 Retention worker örneği

Aşağıdaki SQL **canlı projede çalıştırılmış değildir**. Önce doğru Supabase projesi etkin olmalı, yedek/geri dönüş yaklaşımı belirlenmeli ve `pg_cron` Dashboard'da etkinleştirilmelidir. Cron, tüm tenant'lar adına temizlik yapan ayrıcalıklı bakım işi sayılır; uygulama kullanıcılarına bu iş için genel DELETE yetkisi verilmemelidir.

```sql
-- Index'i canlı verinin hacmi ve migration çalışma penceresi için değerlendirin.
create index if not exists memory_items_retention_scan_idx
  on public.memory_items (updated_at, last_used_at);

-- pg_cron önce Dashboard -> Integrations/Cron tarafında etkinleştirilmiş olmalı.
-- Aynı isimdeki eski işi kaldırarak birden fazla paralel cleanup job oluşmasını önle.
do $schedule$
declare
  existing_job record;
begin
  for existing_job in
    select jobid from cron.job
    where jobname = 'memory-items-retention-180d'
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;

  perform cron.schedule(
    'memory-items-retention-180d',
    '*/15 * * * *',
    $command$
      with doomed as (
        select id
        from public.memory_items
        where updated_at < now() - interval '180 days'
          and (
            last_used_at is null
            or last_used_at < now() - interval '180 days'
          )
        order by updated_at
        limit 1000
      )
      delete from public.memory_items as memory
      using doomed
      where memory.id = doomed.id;
    $command$
  );
end
$schedule$;
```

Bu örnek her çalışmada en fazla 1000 satır siler; dakikada değil 15 dakikada bir çalışır. Üretimdeki birikmiş kayıt sayısı 1000'den fazlaysa backlog, günlük temizleme kapasitesi ve en eski kalan satır ayrıca izlenmelidir. Gerekirse batch boyutu/cadence hacim testine göre ayarlanır. Sırf SQL'in eklenmesi işin koştuğunu kanıtlamaz: `cron.job`, `cron.job_run_details`, silinen satır sayısı ve stale kayıtların yaşı için dashboard/alert gerekir. Database paused/inactive ise cron'un çalışacağı varsayılmamalıdır.

### 2.3 50 kayıt limiti ve yarışlar

Mevcut cleanup, önce 180 günden eski kayıtları siler, ardından `updated_at DESC, id ASC` sıralamasında 50 sonrasındaki satırları batch olarak siler. Her sorguda `user_id = userId` ve RLS bulunduğundan sorgu kapsamı doğru yönde sınırlandırılmış. Ancak retention silmeleri ve overflow silmeleri tek bir transaction içinde değil; hata olursa bir kısmı silinmiş olabilir, bir sonraki kişiselleştirilmiş mesaj cleanup'ı tekrar devam eder. Aynı anda yeni bellek ekleniyorsa 50 kayıt sınırı kısa süre aşılabilir veya yaşlandırma eşiğine yakın satırın güncellenmesiyle hangi satırın korunacağı yarışa girebilir. Yeni eklenen test bu silme sorgularının kullanıcı kapsamı filtresini doğruluyor; gerçek iki hesapla eşzamanlı DB testi ve cron testi hâlâ gereklidir.

## 3. Adversarial prompt injection / semantic firewall

### 3.1 Mevcut savunma ne yapıyor?

`lib/memory-text.ts`, kaydedilen bellek türlerini `preference` ve `communication` ile sınırlar; kısa aday çıkarır; bilinen gizli bilgi ve talimat-iptali örüntülerini reddeder; prompt kurulurken tarihsel satırları yeniden kontrol eder; kayıtları JSON olarak serileştirir. `app/api/chat/route.ts` belleği system prompt'a birleştirmez; ayrı bir `user` mesajı olarak ekler ve sistem talimatında sohbet geçmişi/profil/belleğin güvenilmeyen veri olduğunu söyler. Unicode zero-width ve bidi biçim karakterlerini temizlemeye yönelik ek regresyon testleri de mevcut ana dala birleştirilmiştir.

### 3.2 Kalan risk

Bir blacklist tüm anlamsal saldırıları saptayamaz. Yazım varyantı, farklı diller, homoglyph (Cyrillic/Greek benzeri harfler), uzun bağlamda dağılmış talimatlar, alıntı/rol oyunu ve modelin davranışsal yorumlaması kural tabanlı filtreden kaçabilir. Geçmiş sohbetin tüm kullanıcı/asistan mesajları aynı filtreyle baştan temizlenmiyor; bunlar model bağlamına ayrı role'lerde giriyor. Sistem prompt talimatı riski azaltır ama modelin onu her durumda izlemesini garanti etmez.

Şu an sohbet modeli için uygulamaya özel tool/function execution görünmediğinden saldırganın metinle doğrudan sunucu komutu çalıştırabildiği iddia edilemez. Daha gerçekçi etkiler, istenmeyen yanıt, bağlamın ele geçirilmesi, güvenli olmayan tavsiye veya içerik kalitesinin bozulmasıdır. HF token sistem prompt'una eklenmediğinden “filtre kaçıldı, token kesin sızar” iddiası da kanıtsız olur. Risk modeli, modele verilen gerçek yeteneklerle sınırlanmalıdır.

**Gerekli test planı:**
- Türkçe/İngilizce ve karma dilde zero-width, bidi, noktalama, JSON kaçışları, base64 benzeri içerik, homoglyph ve dolaylı talimat seti.
- Bellek çıkarma ve prompt'a ekleme için aynı vakaları ayrı test et.
- Tarihsel DB satırına elle enjekte edilmiş içerik; güncel extractor'dan geçmiş olması şart değil.
- Modelin deterministik olmayan çıktıları için değerlendirici rubric'i; “string filter test geçti” ile “model injection'a dayanıklı” sonucu ayrılmalı.
- Güvenli sınırlar dışındaki içeriğin reddedildiğini, normal tercihlerin gereksiz yere kaybolmadığını ölçen false-positive testleri. Özellikle çok genel `blockedTerms` öğeleri yanlış pozitif çıkarabilir.

## 4. Stateless serverless rate-limit ve inference maliyeti

### 4.1 Doğrulanmış kusur

`app/api/chat/route.ts` içindeki `Map`, kullanıcı başına 20 istek/60 saniye limiti uygular; entry temizliği ve Map boyutu sınırı vardır. Ancak durum sadece bir Node.js/serverless instance belleğindedir. Vercel farklı instance'lara dağıtırsa aynı kullanıcı farklı yerel sayaçlardan istek geçirebilir. Böylece bu limit **dağıtık bir güvenlik sınırı değildir**. Birden çok hesapla giriş de kullanıcı-ID limitini çoğaltabilir.

### 4.2 Atomik Upstash REST örneği

Upstash REST API, serverless kullanıma ve `POST` gövdesinde Redis komutu göndermeye uygundur. Üretime geçilecekse Redis komutu atomik Lua `EVAL` üzerinden çalıştırılmalı; `INCR` ve `PEXPIRE` ayrı HTTP komutları olarak çağrılmamalıdır. Aksi durumda yarışta sayaç TTL'siz kalabilir. (Resmî docs: https://upstash.com/docs/redis/features/restapi ve https://upstash.com/docs/redis/sdks/ratelimit-ts/overview.)

```ts
// lib/distributed-rate-limit.ts — örnek tasarım; henüz main'e uygulanmış değil.
import { createHmac } from 'node:crypto'

const WINDOW_MS = 60_000
const LIMIT = 20
const TIMEOUT_MS = 1_500

const FIXED_WINDOW_LUA = [
  'local count = redis.call("INCR", KEYS[1])',
  'if count == 1 then redis.call("PEXPIRE", KEYS[1], ARGV[1]) end',
  'return { count, redis.call("PTTL", KEYS[1]) }'
].join('\n')

export async function enforceDistributedChatLimit(userId: string) {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  const salt = process.env.RATE_LIMIT_KEY_SALT

  // Production fails closed: no distributed backend means no paid inference.
  if (!url || !token || !salt) {
    if (process.env.NODE_ENV === 'production') {
      return { allowed: false, unavailable: true, retryAfterSeconds: 2 }
    }
    return localDevelopmentLimiter(userId)
  }

  const endpoint = new URL(url)
  if (endpoint.protocol !== 'https:') {
    return { allowed: false, unavailable: true, retryAfterSeconds: 2 }
  }

  const identifier = createHmac('sha256', salt).update(userId).digest('hex')
  const redisKey = 'dijital-ikiz:chat:' + identifier
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(['EVAL', FIXED_WINDOW_LUA, 1, redisKey, WINDOW_MS]),
    cache: 'no-store',
    signal: AbortSignal.timeout(TIMEOUT_MS)
  })

  if (!response.ok) {
    return { allowed: false, unavailable: true, retryAfterSeconds: 2 }
  }

  const payload: unknown = await response.json()
  // Production implementation must validate the response schema/types and
  // treat provider JSON errors, malformed result arrays, and timeouts as unavailable.
  const result = (payload as { result?: unknown }).result
  if (!Array.isArray(result) || !Number.isInteger(result[0]) || !Number.isInteger(result[1])) {
    return { allowed: false, unavailable: true, retryAfterSeconds: 2 }
  }

  const count = result[0] as number
  const ttl = result[1] as number
  return {
    allowed: count <= LIMIT,
    unavailable: false,
    retryAfterSeconds: Math.max(1, Math.ceil(ttl / 1000))
  }
}
```

Bu, entegrasyon taslağıdır; mevcut `route.ts` değişikliği, mocked REST cevapları, timeout, Redis hata durumu ve paralel istek testleri olmadan doğrudan canlıya alınmamalıdır. Üretimde limit deposu çökerse iki seçenekten biri önceden kararlaştırılmalı: maliyeti korumak için **fail closed** (503; model çağrısı yapılmaz) ya da açıkça kabul edilmiş süreli fail-open. Bu projede ücret kontrolü öncelikli olduğundan varsayılan fail-closed olmalıdır.

2026-10-22 tarihinde Upstash fiyat sayfasında ücretsiz plan için $0, 256 MB, 10 GB aylık bant genişliği ve 500K aylık komut bilgisi listeleniyordu (https://upstash.com/pricing/redis). Bu mevcut fiyat bilgisi, gelecekteki kullanım maliyeti için garanti değildir; hesabı açmadan ve ödeme/limit sayfasını kontrol etmeden ücret doğurabilecek bir planı etkinleştirmeyin.

Ek maliyet kontrolleri:
- kullanıcı başına rate limit + global concurrency/semaphore + günlük toplam istek/token sınırı,
- Qwen/embedding için ayrı limitler,
- 429/5xx retry'larında `Retry-After`, jitter ve azami deneme sayısı,
- HF bütçe/harcama alarmı,
- büyük istek ve uzun yanıt sınırlarının sürdürülmesi,
- rate-limit backend arızasında ücretli inference'a geçmeme.

## 5. Scientific validity / TÜBİTAK Ar-Ge

`lib/twin.ts` valence, arousal, dominance, Big Five ve ifade tarzı için kelime/emoji/noktalama tabanlı heuristic göstergeler üretir. `ml/DATASET_SOURCE_AUDIT.md` lisansı veya erişimi doğrulanmamış veri adaylarını beklemede tutar ve depodaki CSV'lerin boş şablon olduğunu söyler. `ml/EXPERIMENT_PROTOCOL.md` ile anotasyon kılavuzu etik izin, katılımcı kimliğini ayırma, koşul sırasını dengeleme ve ölçülmemiş başarıyı iddia etmeme kurallarını içerir. Bunlar iyi süreç belgeleridir; gerçek model eğitiminin ya da bilimsel başarının kanıtı değiller.

### 5.1 Önceden kayıtlı validasyon protokolü

1. **Etiket/amaç:** VAD üç sürekli hedef olarak ayrı tanımlanmalı; sentiment polarity VAD yerine kullanılamaz. Big Five hedefi izin ve Türkçe geçerliği doğrulanmış ölçekten gelmeli; metni okuyan anotatörün kişilik tahmini “ground truth” sayılamaz.
2. **Katılımcı sızıntısını engelle:** Katılımcı bazlı GroupShuffleSplit ile veriyi yaklaşık %70 train / %15 validation / %15 sealed test olarak böl; aynı `participant_id`, aynı katılımcının mesajları ve metin augmentasyonlarının tümü yalnızca bir bölümde kalmalı. Küçük veri setinde oranları raporla; test setini yeterli katılımcı yokken performans iddiasına zorlamamalı.
3. **Model seçimi:** Yalnızca train içindeki GroupKFold (tercihen 5 fold, katılımcı sayısı yetiyorsa) ve validation setiyle model/hiperparametre seç. Son sealed test setine yalnızca bir defa, model ve eşikler dondurulduktan sonra bak. Birden fazla denemede sealed test üzerinden model seçmek test sızıntısıdır.
4. **Klasik referans:** Her sürekli hedef için eğitim hedef ortalamasını tahmin eden baseline; model, bu basit baseline'ı MAE/RMSE ve uygun diğer metriklerde geçmeli. R² sabit/dar hedef dağılımında tanımsızsa `null` raporla.
5. **VAD metrikleri:** Boyut başına MAE, RMSE, Pearson ve Spearman; mümkünse concordance correlation coefficient (CCC); bootstrap katılımcı düzeyinde %95 güven aralığı. Sadece satır bazlı bootstrap aynı katılımcının bağımlı örneklerini bağımsız sayarak aralığı daraltabilir.
6. **Etiketleyici uyumu:** İki değerlendiricili kategorik nominal/ordinal etiketler için Cohen's kappa (ordinal ölçekte ağırlıklı kappa); birden fazla değerlendirici veya eksik anotasyon için Krippendorff's alpha (ölçeğe uygun nominal/ordinal/interval seçenekleri). Sürekli VAD puanlarında ICC(2,1)/ICC(2,k) mutlak uyum veya interval alpha düşünülmeli. Uyum metriği ve hedef eşiği etikete bakmadan önce tanımlanmalı.
7. **Hata ve yanlılık analizi:** Eksik/çok kısa mesajlar, yazım/argo, bölgesel dil, veri kaynağı ve sınıf dağılımı. Alt grup raporu için gerekli etik/onam/örneklem büyüklüğü olmalı; küçük hücrelerden kişi çıkarımı yapılmasına izin verme. Puanlar psikolojik tanı/klinik karar girdisi olmamalı.
8. **Tekrarlanabilirlik:** Değişmez model revision SHA, seed, veri dosyası SHA-256, split hash'i, bağımlılık sürümleri, hiperparametreler, etiketleme yönergesi ve gerçek metrikler saklanmalı. Onam/kimlik eşleştirme anahtarı GitHub'a konulmamalı.

**Bilimsel NO-GO:** Gerçek uygun veri, etiketleme güvenirliği ve çalıştırılmış sealed test sonucu olmadan %75 başarı, duygu anlama doğruluğu, kişilik kopyalama başarısı veya psikolojik fayda iddiası yayımlanmamalı.

## 6. Secret sprawl, Vercel CLI ve deployment gate

Denetim tabanındaki `.github/workflows/vercel-deploy.yml`:
- `npx --yes vercel@latest` kullanıyordu; bu, aynı commit'in gelecekte farklı CLI sürümünü kurmasına izin verir.
- Token `--token "$VERCEL_TOKEN"`/inline token argümanı üzerinden veriliyordu. Token env üzerinden tüketilmelidir; sırların process argument/log yüzeyine taşınması önlenmelidir.
- `push: main` ve `workflow_dispatch` ikisi de vardı; migration değişkeni gelecekte yanlışlıkla true olursa her main push otomatik production deploy başlatabilirdi.
- `SUPABASE_PRODUCTION_SCHEMA_VERIFIED` doğrulaması yararlı kapı; ancak bir repository variable'ı operatörün doğruluğunu kanıtlamaz. Değişkeni set eden kişi live runbook'u gerçekten tamamlamış olmalı.

PR #84 bu dört başlığın ilk üçüne yönelik dar kapsamlı düzeltme hazırlıyor: sabit CLI, token env, push tetiklemesini kaldırma ve `production` Environment referansı. PR'nin CI'si tamamlanıp birleşmeden bu düzeltme ana dalda kabul edilmiş sayılmamalı. Ayrıca `environment: production` tek başına mandatory approval sağlamaz. GitHub Environment altında main branch restriction ve Required reviewer ayrıca ayarlanmalıdır; özel repo ve plan için bu özelliğin uygun olup olmadığı hesap ayarlarında doğrulanmalıdır. GitHub dokümanları, Required reviewer desteğinin plan/visibility koşullarına bağlı olduğunu açıklar: https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments.

Gerekli son durum:
- sadece manuel workflow dispatch,
- Vercel CLI tam sürüm pin'i,
- token sadece step env,
- production Environment/branch restrictions ve desteklenen durumda bağımsız approval,
- preflight geçmezse validate/deploy çalışmamalı,
- deploy sonrası `/api/health` sadece basic smoke test sayılmalı; tam E2E değildir,
- production Vercel variables ve Supabase project ref ayrı doğrulanmalı.

## 7. CSP, transport ve browser attack surface

`next.config.ts` şu an nosniff, frame deny, Referrer-Policy, CORP ve Permissions-Policy gibi başlıklar veriyor; **Content-Security-Policy bulunmuyor**. Bu, her XSS'nin sömürülebileceğini kanıtlamaz; fakat script/style/network kaynaklarını tarayıcıda daraltan bir kontrol eksik.

Next.js App Router dynamic rendering için CSP nonce modelini belgeler (https://nextjs.org/docs/app/building-your-application/configuring/content-security-policy). Bu projede `proxy.ts` → `lib/supabase-proxy.ts` cookie/session yanıtını yeniden kurabiliyor; nonce/CSP eklemesi bu yenileme yollarını koruyarak uygulanmalı. Statik `next.config.ts` içine `script-src 'unsafe-inline'` yazarak “CSP tamam” demek sıkı CSP değildir. `app/page.tsx` ve sayfalarda inline `style={{...}}` kullanımı var; style attribute'larının CSP ile uyumluluğu da envanterlenmeli.

### Hedef CSP ilkesi (tam entegrasyon örneği, doğrudan tek başına kopyalanacak statik header değil)

```text
default-src 'self';
base-uri 'self';
object-src 'none';
frame-ancestors 'none';
form-action 'self';
script-src 'self' 'nonce-{RANDOM_PER_REQUEST}' 'strict-dynamic';
style-src 'self' 'nonce-{RANDOM_PER_REQUEST}';
style-src-attr 'unsafe-inline';
img-src 'self' data: blob:;
font-src 'self' data:;
connect-src 'self' https://yaryteseqvmyvapyppmy.supabase.co wss://yaryteseqvmyvapyppmy.supabase.co;
worker-src 'self' blob:;
manifest-src 'self';
upgrade-insecure-requests
```

- Nonce kriptografik olarak rastgele ve her HTML isteğinde yeni olmalı.
- Next.js'in nonce'u framework script'lerine aktarması için CSP, render'dan önce request header'ında da bulunmalı; response header'ı ayrıca gönderilmeli.
- Yukarıdaki Supabase host örnek projeye özeldir. Değişken URL veya farklı environment kullanılıyorsa her environment'ın doğru API origin'i oluşturulmalı/validate edilmeli.
- Hugging Face çağrıları server-side `fetch` ile yapıldığı için genellikle tarayıcı `connect-src` iznine ihtiyaç duymaz; istemci tarafında doğrudan HF çağrısı eklenmedikçe HF origin'ini tarayıcı CSP'sine eklemeyin.
- Önce `Content-Security-Policy-Report-Only` ile browser/Next build uyumluluğunu ölçün, sonra enforcing CSP'ye geçin. Production nonce entegrasyonu olmadan `'unsafe-inline'`/ `'unsafe-eval'` ile sahte bir “strict” politika yazmayın.

Diğer kontrol alanları: prod HTTPS, HSTS (yalnızca doğru domain/subdomain stratejisinden sonra), tüm auth/data/chat cevaplarında `Cache-Control: no-store`, aynı-origin mutasyon kontrolü, güvenli cookie ayarları ve dependency/audit güncellemeleri. Gizli token hiçbir `NEXT_PUBLIC_*` değişkenine yerleştirilmemeli.

## 8. Observability, readiness ve circuit breaker

`app/api/health/route.ts` `buildHealthStatus` çağırıyor. `lib/health-status.ts` içinde `ok` proses/route'un cevap verebildiğini; `ready` Supabase URL/publishable key ve HF token metinlerinin dolu olduğunu anlatıyor. Fonksiyon bilerek harici ağ çağrısı yapmıyor. Bu nedenle endpoint **liveness** için uygundur; “Supabase DB bağlantısı ve HF inference kesin çalışıyor” olarak yorumlanmamalıdır. README de `ready`'nin gerçek DB erişimi veya inference başarısını kanıtlamadığını açıkça söylüyor.

Production deployment'ın yalnızca `ok:true, ready:true` görmesi, iki upstream servis de gerçekte kesikse false positive verir. Sağlam düzen:
1. `/api/health`: ucuz liveness, network dependency çağrısı yok.
2. `/api/health/deep`: sadece yetkili/monitoring çağrısı, timeout'lu Supabase salt-okunur probe ve maliyetsiz olabildiğince hafif HF/provider auth/model probe; normal kullanıcı trafiğinde çalıştırılmaz.
3. Deep probe sonucu kısa TTL'li cache'lenir (örn. 15–30 s), her health ping başına inference yapılmaz.
4. Provider error/timeouts/429/5xx sayacı, latency p50/p95/p99 ve başarısız bellek yazım metriği izlenir.
5. Circuit breaker kapalı/açık/half-open durumları test edilir; kısa süreli retry storms engellenir ve `Retry-After` gözetilir.
6. Upstream kesintisinde kullanıcıya kontrollü 503, secretsız structured log/correlation ID ve alarmlar.

Örnek basit timeout ilkesi:

```ts
const controller = new AbortController()
const timeout = setTimeout(() => controller.abort(), 1_500)
try {
  const response = await fetch(probeUrl, {
    headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY! },
    cache: 'no-store',
    signal: controller.signal
  })
  // Statusu endpoint'in gerçek sözleşmesine göre değerlendir;
  // "herhangi bir cevap geldi" ile DB query başarısını eşitleme.
} finally {
  clearTimeout(timeout)
}
```

Bu sadece kontrol iskeletidir. Supabase API anahtarını bilen herkesçe çağrılabilen bir probe veri sızdırmamalı; auth token'ı/logları döndürmemeli. Hugging Face inference endpoint'ine her health ping'te model isteği atmak maliyet ve kapasiteyi sağlık kontrolünün kendisinin artırması riskini getirir.

## CI kapsam boşluğu

`supabase/MIGRATION_RUNBOOK.md` sekiz migration sırası listeliyor. Ana dalın `.github/workflows/ci.yml` PostgreSQL komutu ise:
- `20261008191854_rls_and_ab_performance_hardening.sql`,
- `20261008202255_stage5_memory_fk_index.sql`
dosyalarını doğrudan çalıştırmıyor; diğer Stage 5 + deletion + feedback + chat turn + extension/preference migration'larını çalıştırıyor. Bu nedenle mevcut CI temiz kurulumda **runbook'un tam migration zincirini** doğruladığını söyleyemez. Başarılı CI, live Supabase migration tarihçesini de kanıtlamaz. CI setup'ı, ilk migration'ın ihtiyaç duyduğu tarihsel taban şemasıyla uyumlu hale getirilmeli ve sekiz dosya timestamp sırasıyla temiz Postgres+pgvector üzerinde uygulanmalıdır.

## Kesin GO/NO-GO kararı

### Şu an: **NO-GO**

Stage 6 production promotion yasaklanmalı. Teknik olarak:
- Supabase proje durumu ve parola/migration tarihi doğrulanmamış.
- İki hesapla canlı RLS/sohbet/bellek/feedback/silme E2E yok.
- 180 günlük otomatik cleanup aktif ve gözlemlenmiş değil.
- Distributed rate-limit backend'i yapılandırılmış/gerçekten çalışıyor diye kanıt yok.
- Production CSP uygulanmış/uyumluluğu test edilmiş değil.
- Son workflow sertleştirme PR'si ve tam migration-chain CI iyileştirmesi kapanmamış.
- VAD/Big Five bilimsel başarı iddiası için gerçek etiketli veri/ölçüm yok.

### Sıradaki uygulanabilir sıra

1. **Kaynak kontrolü:** PR #84 Vercel gate testlerinin CI'sini bekle; başarılı değilse düzelt. Herhangi bir production deploy başlatma.
2. **CI doğruluğu:** sekiz migration'ın tamamını sırasıyla uygulayan temiz DB entegrasyon testi ve migration catalog/RLS/RPC ACL assertion'larını ekle.
3. **Dağıtık kullanım sınırı:** Upstash/Redis REST rate-limit implementasyonu, üretimde fail-closed, konfigürasyon ve timeout/hata/eşzamanlılık testleri; limit deposu yokken `ready=false`.
4. **Retention lifecycle:** onaylı saklama kuralı + etkin `pg_cron` görevi, global retention index, batch/backlog/başarı alarmı, stale rows test; gerçek projenin paused kalması etkisini netleştir.
5. **Preference/turn correctness:** DB içi canonical topic conflict/lock, chat idempotency lease, duplicate-client-retry ve paralel preference update testleri.
6. **CSP & app headers:** Proxy/session-cookie akışını bozmadan nonce CSP; önce report-only, sonra browser smoke test.
7. **Monitoring:** health liveness ile deep dependency check ayrımı, 429/5xx/timeouts/latency/bellek-write metriği, circuit breaker ve incident runbook.
8. **Üretim önkoşulu:** doğru Supabase proje ref'i, yedek/geri dönüş planı, runbook'taki sekiz migration'ın applied kaydı, RLS ve fonksiyon ACL sorguları, `extensions` USAGE ve RPC güvenlik modlarının doğrulanması. Proje inactive/parola bilinmiyor ise sıradaki adım restore/migration değil, önce maliyet ve credential sorununu güvenle çözmektir.
9. **Canlı kabul:** iki ayrı test hesabıyla login, sohbet persist/read, bellek tercih değişimi, cross-user denial, feedback owner/variant, silme (özel test kullanıcısında en son). PASS/FAIL/BLOCKED logu ve kanıt.
10. **Yayın onayı:** `SUPABASE_PRODUCTION_SCHEMA_VERIFIED=true` ancak 8. adım gerçekten tamamlanınca; production Environment approvals kullanılabiliyorsa bağımsız onay; manuel Vercel workflow; deployment URL + health/deep-health + model smoke test; deploy/rollback notu.
11. **Bilimsel Ar-Ge ayrı hat:** yalnızca izinli/etiketli veri, kişi bazlı sealed test, rater agreement ve gerçek metrikler sonrası model iddiası. Stage 6 kapsamına sessizce sokulmamalı.

Bu kapılardan herhangi biri belirsizse sonuç **BLOCKED**, yeşil CI sonucu bunu PASS'e çeviremez.
