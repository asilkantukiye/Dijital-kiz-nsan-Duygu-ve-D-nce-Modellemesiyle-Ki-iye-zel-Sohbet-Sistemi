# Repo-wide mikro denetim — 23 Ekim 2026

- İncelenen dal: `security/stage5.1-hardening-20261023`
- İncelenen commit: `5a2a7fa6dcf8f7991c050d528dcaef993f66e5ca`
- Kapsam: uygulama ağacındaki 161 dosya (124 kod/test/SQL/ML dosyası ve belgeler dahil), repository-root GitHub Actions workflow'ları ve `infinityfree/` statik hedefi.
- Sonuç: **production için NO-GO; önce P0/P1 bütünlük düzeltmeleri ve gerçek ortam doğrulamaları.**
- Bu belge statik kod incelemesidir. Üretim veritabanına bağlanılmadı; migration, deploy, ücretli inference veya Kaggle GPU eğitimi çalıştırılmadı.

## Yönetici özeti

Bu dalda önemli savunmalar var: istek gövdesi sınırı, origin kontrolü, dağıtık rate limit, kullanıcı kapsamlı bellek araması, çift mesajı tek transaction'da yazma, nonce tabanlı CSP, retention migration'ı ve SQL entegrasyon testleri. Buna rağmen üç üretim engeli öne çıkıyor:

1. Kullanıcı JWT'sine açık tablo yetkileri/RPC, kendi sohbet kayıtlarına sahte assistant yanıtı veya değiştirilmiş profil yazılmasına izin veriyor. Bu kullanıcılar-arası RLS sızıntısı değil; **araştırma verisinin doğruluğu ve kayıtların güvenilirliği** sorunu.
2. Sohbet API'si ücretli model yanıtını aldıktan sonra kalıcı yazma yapıyor ve idempotency anahtarı yok. Yanıt istemciye ulaşmazsa tekrar gönderim yeni model çağrısı ve ikinci kayıt üretebilir.
3. Profil, geçmiş profile ait sürüm kontrolü olmadan read-modify-write yapılıyor; eşzamanlı sekmeler birbirinin profil güncellemesini kaybedebilir.

Ayrıca bellek kaynak mesaj sahipliği doğrudan tablo yazımlarında zorlanmıyor; embedding normalizasyonu biçimi bozuk bazı çıktıları sessizce sıfırlarla doldurabiliyor; cron/trigger temizliği bazı durumlarda tek işlemde sınırsız sayıda satırı tarayıp silebiliyor; araştırma dışa aktarımlarındaki metinler takma ad eklenmesine rağmen kişisel bilgi içerebilir.

## Bulgular

### AUD-01 — HIGH — Assistant yanıtı/profil verisi veritabanı katmanında sahte yazılabiliyor

**Konum:** `supabase/schema.sql:27–46`; ayrıca `supabase/migrations/20261008191854_rls_and_ab_performance_hardening.sql:6–22` ve `supabase/migrations/20261020200000_atomic_chat_turn_persistence.sql:63–80, 128–130`.

**Neden:** RLS, `user_id = auth.uid()` koşulunu zorlar ama mesajın rolünü hangi kod yolunun oluşturduğunu ayırt etmez. `authenticated` rolüne `messages` ve `twin_profiles` üzerinde INSERT/UPDATE yetkileri veriliyor. Aynı role `persist_chat_turn` RPC'si için EXECUTE izni veriliyor; RPC `SECURITY INVOKER` ve assistant yanıtı metnini çağırandan alıyor. Tarayıcıdaki publishable key ve kullanıcının JWT'siyle bu RPC doğrudan çağrılabilir. Böylece kullanıcı kendi hesabında uydurma assistant mesajları, tarih/sıra manipülasyonu ve keyfî profil snapshot'ları oluşturabilir. Bu kayıtlar daha sonra sohbet geçmişine, kör değerlendirme dışa aktarımına ve geri bildirim analizine girebilir.

**Üretim düzeltmesi:** Mesaj/ikinci profil yazımını yalnızca sunucu tarafından çağrılabilen servis katmanına taşıyın. Basitçe INSERT iznini kaldırmak yetmez; mevcut route da authenticated JWT ile RPC çağırdığı için sunucu çağrısı ayrıca değiştirilmelidir. Servis anahtarı yalnızca server-only modülde bulunmalı; hiçbir NEXT_PUBLIC değişkeni olmamalı. Servis RPC'si açık kullanıcı kimliğini alıp bütün satırları o kullanıcıya bağlamalı ve execute iznini yalnızca `service_role` rolüne vermelidir.

    -- Yeni server-only RPC imzasına geçildiğinde, eski imza kullanıcı JWT'lerine açık kalmamalı.
    REVOKE INSERT, UPDATE ON public.messages FROM authenticated;
    REVOKE INSERT, UPDATE ON public.twin_profiles FROM authenticated;
    REVOKE EXECUTE ON FUNCTION public.persist_chat_turn(
      text, text, text, timestamptz, timestamptz, jsonb
    ) FROM PUBLIC, anon, authenticated;

    -- Yeni, ayrı bir server-only imza için:
    -- GRANT EXECUTE ON FUNCTION public.persist_chat_turn_server(...) TO service_role;

Yeni `persist_chat_turn_server` fonksiyonu `p_user_id uuid` parametresiyle `SECURITY DEFINER`, sabit `search_path = pg_catalog, public`, sıkı parametre kontrolleri ve her insertte açık `user_id = p_user_id` kullanmalıdır. Route, bu fonksiyonu yalnızca server-only service-role client üzerinden çağırmalıdır. Eski fonksiyonun authenticated erişimini ancak route yeni fonksiyona taşındıktan sonra kaldırın. Mesajları tarayıcıdan okuma (SELECT) ve kullanıcının kendi kayıtlarını silme akışını ayrı izinlerle koruyun. Buna ek olarak, API'nin assistant içeriğini doğrudan veri tabanına yazan başka hiçbir authenticated RPC/trigger yolu kalmadığını katalog testiyle doğrulayın.

**Regresyon testi:** Kullanıcı A, kendi JWT'siyle doğrudan assistant rolünde mesaj INSERT etmeyi, mevcut mesajı UPDATE etmeyi ve eski `persist_chat_turn` RPC'sini çağırmayı deneyince reddedilmeli; gerçek API route'u server-only yetkiyle başarılı olmalı. Kullanıcı A'nın B satırlarına erişimi aynı testte reddedilmeli.

### AUD-02 — HIGH — Chat isteği idempotent değil; yeniden deneme çift inference/kayıt doğurabilir

**Konum:** `app/api/chat/route.ts:219–250`; `app/page.tsx:219–247`; ayrıca `lib/huggingface.ts:120–176`.

**Neden:** Model çağrısı `qwenChat` önce çalışıyor, `persist_chat_turn` daha sonra çağrılıyor. İstemci yanıtı alamazsa `app/page.tsx` taslağı geri yükleyip tekrar göndermeye izin veriyor. İstek gövdesinde değişmeyen bir idempotency anahtarı yok; veritabanında istek kimliği/önceki yanıt ledger'ı da yok. İstemci ağ zaman aşımını sunucunun işlemi tamamlamadığı anlamına gelemez. İlk çağrı model maliyetini tüketmiş, kayıt yapmış ama HTTP yanıtı kaybolmuş olabilir; tekrar istek ikinci bir ücretli inference ve çift sohbet turu üretir. Benzer belirsizlik sağlayıcıya yapılan retry'larda da var: timeout sonrası sunucu sağlayıcının önceki çağrıyı işleyip işlemediğini bilemez.

**Üretim düzeltmesi:** İstemci bir UUID idempotency anahtarı üretmeli ve yalnızca kullanıcı metni/variant aynı kaldığı sürece aynı anahtarı retry boyunca korumalı. Sunucu model çağrısından **önce** kullanıcı + anahtar için atomik istek kaydı/claim oluşturmalı; aynı anahtara gelen ikinci paralel istek inference başlatmamalı. Sonuç ve chat turn bir transaction içinde kaydedilip replay edilebilir yanıt olarak saklanmalı. Süreç model cevap verdikten ama DB'ye sonucu yazmadan çökerse üçüncü taraf inference için mutlak exactly-once garantisi mümkün değildir; bu durum otomatik yeni ücretli çağrı başlatmak yerine “sonucu belirsiz” olarak ele alınmalıdır.

    CREATE TABLE public.chat_request_ledger (
      user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      request_id uuid NOT NULL,
      request_hash text NOT NULL,
      status text NOT NULL CHECK (status IN ('processing','completed','uncertain')),
      reply text,
      assistant_message_id uuid,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, request_id),
      CHECK (
        (status = 'completed' AND reply IS NOT NULL AND assistant_message_id IS NOT NULL)
        OR status <> 'completed'
      )
    );

Bu tabloyu eklemek tek başına yeterli değildir: kullanıcı kapsamlı atomik “claim-or-replay” RPC'si, aynı request_id ile farklı içerik gönderimini engelleyen request_hash kontrolü, tamamlanmış cevabı tekrar döndürme ve crash/lease süreci de uygulanmalıdır. API başarılı bir cevap verdikten sonra aynı request_id ile yapılan retry yeni Qwen çağrısı başlatmamalıdır. SQL entegrasyon testi iki eşzamanlı aynı key isteğinde tek ledger kaydı/tek turn olduğunu doğrulamalıdır.

### AUD-03 — MEDIUM — Eşzamanlı mesajlarda profil güncellemesi kaybolabilir (lost update)

**Konum:** `app/api/chat/route.ts:142–151`; `supabase/migrations/20261020200000_atomic_chat_turn_persistence.sql:45–56`.

**Neden:** Route mevcut profili okuyup `analyzeMessage(message, previous)` hesaplıyor. Model çıkarımı sürerken başka bir sekme aynı eski profili okuyabilir. RPC `ON CONFLICT (user_id) DO UPDATE SET profile = excluded.profile` ile version/CAS olmadan son gelen tüm profili yazar. İki istek ayrı sohbet çifti olarak kaydedilse de birinin profil etkisi diğerinin güncellemesiyle kaybolabilir. Tarayıcıdaki `chatSendInFlight` yalnızca tek React örneğini korur; diğer sekme, cihaz veya API istemcisini serialize etmez.

**Üretim düzeltmesi:** Profil satırına monoton sürüm ekleyin ve güncellemeyi compare-and-swap yapın; sürüm uyuşmazlığında profil güncellemesi başarısız olmalı, son profil tekrar okunup yeni profile dayalı işlem idempotency ledger'ı üzerinden yeniden uzlaştırılmalıdır.

    ALTER TABLE public.twin_profiles
      ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT 0;

    -- RPC içinde beklenen sürüm parametresi p_expected_version olsun.
    INSERT INTO public.twin_profiles (user_id, profile, updated_at, version)
    VALUES (v_user_id, p_profile_snapshot, p_assistant_created_at, 1)
    ON CONFLICT (user_id) DO UPDATE
       SET profile = EXCLUDED.profile,
           updated_at = EXCLUDED.updated_at,
           version = public.twin_profiles.version + 1
     WHERE public.twin_profiles.version = p_expected_version
    RETURNING version INTO v_new_version;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Profile version conflict' USING ERRCODE = '40001';
    END IF;

İlk profil satırında beklenen sürüm 0 kabul edilmeli; çakışma retry'si yeni bir model çağrısını idempotency anahtarı olmadan başlatmamalıdır.

### AUD-04 — MEDIUM — Memory provenance, source mesajın sahibi/rolü seviyesinde korunmuyor

**Konum:** `supabase/migrations/20261008202104_stage5_memory_engine.sql:5–31`; `supabase/migrations/20261021211000_stage5_atomic_memory_preference_update.sql:24–41, 62–64`; yeni RPC'de kontroller `20261023194000_stage5_1_atomic_preference_upsert.sql` içindedir.

**Neden:** `memory_items.source_message_id` yalnızca `messages(id)` foreign key'idir. Kullanıcıya ait memory satırı yazma yetkisi, `user_id = auth.uid()` şartıyla sınırlı olsa da satır başka bir kullanıcının geçerli message UUID'sine referans verebilir. Yeni `upsert_my_memory_preference` RPC'si kaynak sahipliğini kontrol ediyor; ancak doğrudan INSERT/UPDATE'ler ve eski `replace_my_memory_preference` RPC'si aynı kontrolü yapmıyor. Bu, mesaj içeriğini doğrudan sızdırmaz; fakat bellek kaynak/katılımcı atfını ve araştırma kayıtlarının güvenilirliğini bozar.

**Üretim düzeltmesi:** Kontrolü yalnız uygulamaya değil DB sınırına koyun. RLS'li authenticated çağrıda yabancı mesaj satırı görünmeyeceğinden `EXISTS` kontrolü başarısız olur; aynı kullanıcı için yalnızca `role='user'` mesajı kabul edilir.

    CREATE OR REPLACE FUNCTION public.validate_memory_source_ownership()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY INVOKER
    SET search_path = pg_catalog, public
    AS $$
    BEGIN
      IF NEW.source_message_id IS NOT NULL AND NOT EXISTS (
        SELECT 1
          FROM public.messages AS m
         WHERE m.id = NEW.source_message_id
           AND m.user_id = NEW.user_id
           AND m.role = 'user'
      ) THEN
        RAISE EXCEPTION 'Memory source must be an owned user message';
      END IF;
      RETURN NEW;
    END;
    $$;

    CREATE TRIGGER memory_source_owner_guard
    BEFORE INSERT OR UPDATE OF source_message_id, user_id
    ON public.memory_items
    FOR EACH ROW EXECUTE FUNCTION public.validate_memory_source_ownership();

Aynı şartı eski `replace_my_memory_preference` RPC'sine de ekleyin veya rollout sonrası kullanımı doğrulayıp eski RPC'yi kaldırın. Testte authenticated kullanıcı A, B mesajının ID'sini memory insert/update/old-RPC içine koyunca reddedilmeli; kendi user mesajı kabul edilmeli.

### AUD-05 — MEDIUM — Embedding normalizasyonu bozuk token vektörünü sıfırlarla “geçerli” hâle getirebilir

**Konum:** `lib/huggingface.ts:13–32`.

**Neden:** Token embedding havuzlamasında her token satırının uzunluğu 384 mü diye kontrol edilmiyor. İlgili indekste değer olmayan/sonlu olmayan elemanlar filtreleniyor; hiçbir usable değer kalmadığında `0` yerleştiriliyor. Sonuç yine 384 boyutlu ve sonlu göründüğünden hatalı, ragged veya beklenmedik sağlayıcı çıktısı sessizce normalize edilerek cosine retrieval içine girebilir. Vektör biçimindeki tek tek sayı değerleri de önce `Number` ile coerce edilir; örneğin sayısal olmayan türlerden gelen bazı değerler yanlışlıkla kabul edilebilir.

**Üretim düzeltmesi:** Her satırın 384 boyutlu olduğunu ve tüm bileşenlerinin gerçekten sonlu sayı olduğunu kontrol edin; padding/truncation veya sentetik sıfır üretmeyin. Beklenmeyen şekil açık hata vermeli; bellek kaydı yazılmamalıdır.

    function finiteVector(row: unknown): number[] {
      if (!Array.isArray(row) || row.length !== EMBEDDING_DIMENSION) {
        throw new Error('Embedding shape mismatch');
      }
      if (row.some((value) =>
        typeof value !== 'number' || !Number.isFinite(value)
      )) {
        throw new Error('Embedding contains invalid values');
      }
      return row as number[];
    }

Token-level çıktı için her token satırına önce `finiteVector` uygulayın ve ancak tüm satırlar doğruysa havuzlayın. Sonra sıfır normu reddedip L2 normalizasyonu yapın. Testler 383/385 boyut, NaN, string sayı, iç içe ragged dizi ve sıfır normu içermeli.

### AUD-06 — MEDIUM — Bellek retention/cap işi ve trigger bazı işlemlerde sınırsız miktarda satır tarayabilir/silebilir

**Konum:** `supabase/migrations/20261023193000_stage5_1_memory_retention_cron.sql:69–86`; `supabase/migrations/20261023195000_stage5_1_memory_hard_cap.sql:41–51`.

**Neden:** Gecelik cap-cleanup CTE'si bütün `memory_items` tablosu üzerinde her kullanıcı için `row_number()` hesaplar; en sonda `LIMIT 1000` konması global partition/sort maliyetini 1000 satırla sınırlandırmaz. Benzer şekilde insert trigger'ında `OFFSET 49` sonrası overflow sorgusunda LIMIT yok: tarihsel olarak çok fazla kaydı olan tek hesap, sonraki insert sırasında tek transaction'da devasa DELETE ve kilit süresi yaratabilir. Bu işlemlerin bounded diye belgelenen iş yükü gerçekte her adımda bounded değil.

**Üretim düzeltmesi:** İlk rollout'tan önce tarihsel overflow'u ölçün ve ayrı, kontrollü bakım işiyle küçük batch'ler halinde temizleyin. Günlük iş yalnızca sınırlandırılmış sayıda fazla hesabı ve her hesaptan sınırlı sayıda kaydı işleyecek bir plana çevrilmeli. Örnek temel iskelet:

    WITH over_cap_users AS (
      SELECT user_id
        FROM public.memory_items
       GROUP BY user_id
      HAVING count(*) > 50
       ORDER BY user_id
       LIMIT 100
    ),
    overflow AS (
      SELECT candidate.id
        FROM over_cap_users AS u
        CROSS JOIN LATERAL (
          SELECT id
            FROM public.memory_items
           WHERE user_id = u.user_id
           ORDER BY updated_at DESC, id ASC
           OFFSET 50
           LIMIT 1000
        ) AS candidate
       LIMIT 1000
    )
    DELETE FROM public.memory_items AS memory
    USING overflow
    WHERE memory.id = overflow.id;

Bu örneğin COUNT aşaması hâlâ tabloyu okuyabilir; gerçek ölçeğe göre partial/covering indeks, ölçümlü batch cursor veya kullanıcı iş kuyruğu değerlendirilmelidir. Hard-cap trigger'ında sınırlı silme tek başına eski hesapların 50'ye anında düşmesini garanti etmez; ya ön temizlik rollout'u zorunlu kılınmalı ya da eski over-cap hesaplar için kontrollü geçiş durumu tasarlanmalıdır. “Her zaman en fazla 50” iddiası ile “her adımda sınırlı iş” garantisi birlikte test edilmelidir.

### AUD-07 — MEDIUM — Model sağlayıcısı kesintilerinde paylaşılan circuit breaker yok; retry yükü büyütebilir

**Konum:** `lib/huggingface.ts:120–176`; `lib/distributed-rate-limit.ts:147–245`; `app/api/chat/route.ts` model çağrı bölümü.

**Neden:** HF çağrısı sınırlı kez retry edilse de, sağlayıcı kesintisi sırasında eşzamanlı serverless instance'lar bağımsız retry yapar. Dağıtık rate limiter istek sayısını sınırlar fakat upstream arızasını bildiği için provider çağrılarını kesen circuit breaker değildir. Her istek iki denemeye kadar sürebildiği için hata durumunda latency ve upstream istekleri artar. Timeout sonrasında upstream'in önceki işi kabul edip etmediği de belirsiz olabilir.

**Üretim düzeltmesi:** Upstash üzerinde atomik shared circuit-breaker state (closed/open/half-open, cooldown, tek probe lease) tutun. Belirli sayıda timeout/5xx sonrası kullanıcıya hızlı 503/Retry-After dönün ve cooldown içinde Qwen çağrısı başlatmayın. 401/403/4xx için otomatik retry yapmayın; 429 için sağlayıcı Retry-After bilgisi varsa onu uygulayın. Mevcut rate limitin kalması gerekir; circuit breaker onun yerine geçmez. Provider çağrı sayısı, timeout ve breaker geçişleri PII içermeyen metriklerle gözlenmeli.

### AUD-08 — MEDIUM — Araştırma dışa aktarımı takma ad üretir ama metin PII'sini anonimleştirmez

**Konum:** `ml/export_chat_pairs_for_blind_review.py:141–166, 189–205`; çıktı güvenlik mesajı `236–255`.

**Neden:** Script ham user ID'den HMAC takma adı üretir ve ID'yi çıktıdan çıkarır; ancak `prompt_text` ve `response_text` as-is kopyalanır. Metnin içinde ad-soyad, e-posta, telefon, adres, okul/sınıf, sağlık veya başka kişisel veri varsa blind-review CSV'sinde kalır. Bu nedenle dosya “pseudonymised” olabilir ama otomatik olarak anonim veya paylaşılabilir değildir. `--overwrite` onayı gizlilik temizliği yerine geçmez.

**Üretim düzeltmesi:** Dışa aktarma adımına paylaşım öncesi PII tespit/redaksiyon kapısı ekleyin; yüksek riskli eşleşmeleri sessizce bozmaktansa manuel incelemeye karantinaya alın. Kaynak/katılımcı izni doğrulanmış olmalı; ham metin ve temizlenmiş metnin nerede saklandığı belgelenmeli.

    def require_privacy_review(rows):
        findings = scan_for_pii(rows)  # email, phone, URLs, IDs, address/name patterns
        if findings:
            raise ValueError(
                "PII candidate detected; redact/review before blind-review export."
            )
        return rows

`scan_for_pii` örneği tek başına ad tespiti için kusursuz değildir. Bu yüzden privacy review insan kontrolü ve onam/izin kaydı ile birlikte olmalı; log'a ham eşleşen metin yazılmamalıdır. Bu CSV'nin yalnızca yerel, erişimi kısıtlı araştırma alanında tutulması ve Git'e eklenmemesi gerekir; `.gitignore` koruması mevcut, fakat tek başına paylaşım onayı değildir.

### AUD-09 — MEDIUM — Kaggle eğitim workflow'su durum metnini gevşek regex ile yorumluyor

**Konum:** `.github/workflows/kaggle-sentiment-pilot.yml:93–117`.

**Neden:** Başarısızlık ve tamamlanma için tüm CLI çıktısında `failed`, `error`, `complete`, `success` alt dizgileri aranıyor. Bu koşullar gerçek bir status alanına bağlı değil; örneğin `incomplete` içinde `complete` bulunur, açıklama metni/başka bir satır da yanlış pozitif verebilir. Sonuç olarak workflow tamamlanmayan kernel'i tamamlanmış sayıp devam edebilir veya zararsız açıklama metninden dolayı hata sayabilir. Sonraki adımın artifact kontrolü ikinci savunmadır ama status parser'ın yerine geçmez.

**Üretim düzeltmesi:** Kaggle CLI'nın gerçek çıktısını sabit fixture'larla doğrulayın ve yalnızca tam status alanını whitelist üzerinden parse edin. Bilinmeyen/bozuk status fail-closed olmalı.

    status="$(kaggle kernels status "$KAGGLE_KERNEL_ID")"
    parsed_status="$(printf '%s\n' "$status" |
      awk -F': *' 'tolower($1) == "status" { print tolower($2); exit }')"

    case "$parsed_status" in
      complete|completed|success) completed=1 ;;
      error|failed|cancelled) echo "::error::Kaggle run failed"; exit 1 ;;
      running|queued|pending|"" ) : ;; 
      *) echo "::error::Unknown Kaggle status"; exit 1 ;;
    esac

Yukarıdaki durum isimleri gerçek Kaggle CLI sürümüyle test edilip sonra sabitlenmelidir; farklı çıktı varyantları sessizce başarılı sayılmamalıdır. Aynı iş akışında model çıktısının ilgili run'a ait manifest/sha ile eşleştiğini de kontrol edin.

### AUD-10 — MEDIUM — GitHub Actions action'ları değişebilir tag'lere sabitlenmiş

**Konum:** `.github/workflows/ci.yml:39, 42, 49`; `.github/workflows/vercel-deploy.yml:88, 91, 98`; `.github/workflows/infinityfree-deploy.yml:68, 71`; `.github/workflows/kaggle-sentiment-pilot.yml:35, 38, 56`.

**Neden:** `actions/checkout@v7`, `actions/setup-node@v7`, `actions/setup-python@v7` ve `SamKirkland/FTP-Deploy-Action@v4.4.0` değişebilir ref'lerdir; aynı commit tekrar çalıştırıldığında farklı action kodu çekilebilir. Kaggle CLI da `kaggle>=1.8.2,<2` olarak patch sürümüne kadar sabitlenmemiştir. Bu, doğrudan doğrulanmış bir exploit değil; release/deploy zinciri için tedarik zinciri tekrar üretilebilirliği zayıflığıdır.

**Üretim düzeltmesi:** Onaylı action sürümlerini tam commit SHA'larına sabitleyin ve sürüm/tag karşılığını yorumda belirtin. Python/Node bağımlılıklarını lockfile veya hash doğrulamalı constraints ile yönetin; güncellemeleri otomatik PR + CI üzerinden yapın.

    # Örnek biçim; SHA değerini resmi action tag'inden doğrulanmış gerçek commit SHA'sı ile doldurun.
    uses: actions/checkout@<40-character-reviewed-commit-sha>
    with:
      persist-credentials: false

Placeholder SHA bu hâliyle kullanılmamalıdır. Gerçek SHA resmi action deposundan kontrol edilip eklenmelidir. deploy workflow'sunda token gerektiren adımlardan önce yalnızca read permission'ları açık tutulmalı, erişim gerekmeyen job'lara secret aktarılmamalıdır.

### AUD-11 — MEDIUM — Model/ML eğitimi tekrar üretilebilirliği tam sabitlenmemiş

**Konum:** `ml/requirements.txt:1–7`; `ml/train_regressor.py:149–154, 213–229, 284–304`.

**Neden:** PyTorch, Transformers, pandas ve diğer ML paketleri minimum sürüm aralıklarıyla listeleniyor; çözülmüş sürümler kilitlenmiyor. Eğitimde `--model-revision` isteğe bağlı ve varsayılanı `None`; bu durumda HF modeli/tokenizer değişebilir, ancak rapor revision verilmediğini açıkça kaydeder. Sabit seed tek başına GPU determinism veya dependency/model kodunun aynı kalmasını sağlamaz.

**Üretim düzeltmesi:** Eğitim komutunda tam HF commit SHA zorunlu olmalı; tokenizer ve model aynı revizyona sabitlenmeli. Pip için hash'li lock/constraints ve eğitim raporunda dataset hash'lerinin yanı sıra model/tokenizer revision, çalışma ortamı, CUDA/driver ve bağımlılık çözümlemesi yer almalı.

    # Import bölümüne: import re
    parser.add_argument(
        "--model-revision",
        required=True,
        help="Hugging Face modelinin 40 karakterli commit SHA'sı",
    )
    if not re.fullmatch(r"[0-9a-f]{40}", args.model_revision):
        raise SystemExit("--model-revision tam commit SHA olmalı.")

Bu, mevcut bilinçli deneysel tasarımdaki esnekliği azaltır ama karşılaştırılabilir metrikler için gerekir. Gerçek eğitim sonucu üretilmediği sürece repository'deki notebook syntax/guardrail testleri model performansı kanıtı değildir.

### AUD-12 — MEDIUM — Heuristic puanlar Big Five/VAD ölçümü gibi yorumlanırsa bilimsel geçerlilik riski var

**Konum:** `lib/twin.ts:18–33, 59–85`; UI etiketleri `app/page.tsx:47–60`; `ml/model-card.md:15–19`.

**Neden:** `analyzeMessage` sabit regex ve ağırlıklarla valence/arousal/dominance, beş Big Five boyutu ve iletişim stili skorları üretip önceki profille sabit `alpha = 0.25` üzerinden yumuşatıyor. Örneğin noktalama/emoji/“çok” gibi işaretler arousal/extraversion değiştiriyor; uzun mesaj sorumluluğu artırıyor; olumlu kelimeler agreeableness artırıyor. Bu eşlemelerin katılımcı ölçeği, kalibrasyonu, belirsizlik aralığı ya da bağımsız test skoru yok. Bir mesajın tonu kişilik özelliğinin doğrulanmış ölçümü değildir.

**Düzeltme:** Şimdilik bu çıktıyı “heuristic prototip göstergesi” diye etiketleyin; psikolojik ölçüm, kişilik kopyalama başarı oranı veya klinik değerlendirme gibi sunmayın. Gerçek model iddiasından önce onamlı ve doğrulanmış etiketler, kişi bazlı train/validation/test ayrımı, katılımcılar arası ölçüm güvenirliği, boyut bazında MAE/RMSE/korelasyon ve kalibre edilmiş belirsizlik gereklidir. `alpha` ve regex skorları ayrı benchmark ile karşılaştırılmalıdır. README/model kartı bu sınırı şimdiden belirtiyor; UI'nin etiket ve metinlerinde de aynı açıklık korunmalı.

### AUD-13 — MEDIUM — Veri silme işlemiyle eşzamanlı chat isteği kayıtları tekrar oluşturabilir

**Konum:** `app/api/data/route.ts:20–25`; `supabase/migrations/20261018190000_atomic_user_data_deletion.sql:18–31`; `app/page.tsx:304–332`; sohbet persist noktası `app/api/chat/route.ts:239–250`.

**Neden:** Silme RPC'si aynı kullanıcının mevcut satırlarını transaction içinde siler; fakat devam eden başka bir sekmede model çağrısı çalışıyorsa, silme transaction'ından sonra `persist_chat_turn` yeni mesaj ve profil tekrar ekleyebilir. Buton yalnızca aynı UI örneğindeki yüklenme durumunu kısıtlıyor; veritabanında deletion generation/lock yok. Kullanıcı silme işlemi başarı yanıtı aldıktan sonra bir yarış durumu nedeniyle sohbet verisinin geri oluştuğunu görebilir.

**Üretim düzeltmesi:** Kullanıcı başına bir veri nesli (`generation`) tutun. Chat isteği modele gitmeden nesli okur ve persist RPC'ye beklenen nesli gönderir; delete RPC aynı kullanıcı kilidini alır, nesli artırır ve kayıtları siler. Persist RPC kilit altında nesli tekrar kontrol eder; eski nesilden gelen chat turn'i kaydetmez. Bunu AUD-02 idempotency ledger'ıyla aynı transaction/lock düzenine entegre edin. Silme endpoint'i “işlem devam ediyor” durumunu da UI'ye gösterebilir, fakat istemci kilidi tek başına çözüm değildir.

### AUD-14 — LOW/MEDIUM — Feedback yüklemesi sınırsız; büyük geçmişte istemci payload'ı büyür

**Konum:** `app/page.tsx:134–155`, özellikle 151–155.

**Neden:** Sohbet geçmişi son 100 mesajla sınırlı yüklenirken `message_feedback` sorgusu kullanıcıya ait tüm geri bildirim satırlarını limitsiz getiriyor ve sonra yalnız görünür mesajlar için gerekli subset'e indirgeniyor. Hesap zaman içinde çok sayıda mesaj puanlarsa ilk ekran açılışında gereksiz DB transferi ve JS belleği artar.

**Üretim düzeltmesi:** Son 100 mesajı aldıktan sonra yalnızca bu mesaj ID'lerine bağlı feedback kayıtlarını sorgulayın; ID listesi boşsa sorgu çalıştırmayın. Liste çok büyük olabilirse güvenli batch kullanın veya messages sorgusuyla server-side ilişkili/filtrelenmiş endpoint oluşturun.

    const visibleIds = (storedMessages ?? [])
      .map((item) => item.id)
      .filter((id): id is string => typeof id === 'string');

    const feedbackQuery = visibleIds.length
      ? supabase
          .from('message_feedback')
          .select('message_id,rating')
          .eq('user_id', session.user.id)
          .in('message_id', visibleIds)
      : Promise.resolve({ data: [], error: null });

Gerçek Supabase tipleri için Promise birleşimi uygun şekilde tiplendirilmelidir; sadece kod örneği nedeniyle gerçeğe aykırı bir union type bırakmayın. Mevcut 100 mesaj sınırını ve RLS'yi koruyun.

### AUD-15 — LOW — Geniş substring prompt/bellek filtresi meşru tercihleri de yanlışlıkla düşürebilir

**Konum:** `lib/memory-text.ts:18–36, 217–236`; belleğe kabul/formatlama çağrıları aynı dosyanın 245–356 aralığında.

**Neden:** Bazı güvenlik kelimeleri normalize metinde `includes` ile aranıyor; tüm terimler kelime sınırı veya bağlam ayrımıyla eşleşmiyor. Kısa bir terimin başka bir kelimenin alt dizgisi olması güvenli/normal bir tercih metninin belleğe hiç kaydedilmemesine neden olabilir. Diğer taraftan, regex blocklist dilsel/semantik prompt injection'ın tüm varyantlarını yakalayamaz. İkinci durumun prompt sınırıyla azaltılması doğru; blocklist tam güvenlik duvarı değildir.

**Düzeltme:** Basit kelimeleri Unicode harf/rakam sınırlarıyla token bazlı eşleştirin, ifade kalıplarını ayrı tutun ve yanlış pozitif/negatif testlerini Türkçe çekim, birleşik kelime, görünmez format karakteri ve çok dilli paraphrase örnekleriyle genişletin. Belleği `system` mesajı içine komut gibi yerleştirmeyin; mevcut JSON referans sınırı/untrusted prompt talimatı korunmalı. Kötü amaçlı metin denemeleri ile normal tercih corpus'u üzerinde bloklama doğruluk ölçümü yapılmalı.

### AUD-16 — MEDIUM — Derin sağlık kontrolü token/upstream kimliğini doğruluyor, seçili model inference'ının çalışacağını kanıtlamıyor

**Konum:** `lib/health-probes.ts`; `app/api/health/deep/route.ts`; deploy kapısı `.github/workflows/vercel-deploy.yml:175–267`.

**Neden:** Deep probe Supabase Auth, Hugging Face identity endpoint ve Upstash PING kontrol ediyor; ücretli Qwen inference çalıştırmıyor (bu doğru bir maliyet/gizlilik tercihi). Ancak token geçerli olsa da `HF_MODEL` adı, sağlayıcının o model için kullanılabilirliği, model limitleri veya gerçek chat response schema'sı yanlış olabilir. Mevcut deployment smoke test, gerçek chat işlemi çalışacağını kanıtlamaz.

**Düzeltme:** Token/upstream connectivity ile model availability'yi ayrı readiness sinyalleri olarak isimlendirin. Ücretli inference yapmayacaksanız model ID'yi yapılandırma doğrulamasında biçim/kaynak metadata düzeyinde kontrol edin ve deployment sonrası kontrollü, açıkça izin verilen test hesabıyla bir canary chat testi yapın; maliyetli canary yapılmıyorsa raporda bu doğrulamanın olmadığı açıkça belirtilsin. Health endpoint'leri yanıt/metin, secret veya kullanıcı verisi döndürmemeli; mevcut no-store ve secret koruması korunmalı.

## Kapsam ve doğrulama sınırları

### Kapsanan kaynak grupları

- Next.js App Router: `app/` sayfaları ve dört API ailesi (chat, data deletion, feedback, health).
- Runtime yardımcıları: request body/origin/CSRF, validation, distributed rate limiting, Supabase SSR/proxy, CSP, health probes, HF chat/embedding, memory extraction/retrieval, profile heuristic.
- SQL: `supabase/schema.sql`, 11 timestamp'li migration, preference/chat/delete RPC'leri, RLS ve index tanımları.
- CI/CD: root `.github/workflows/ci.yml`, `vercel-deploy.yml`, `infinityfree-deploy.yml`, `kaggle-sentiment-pilot.yml`; `next.config.ts`, `vercel.json`, package scripts.
- ML: train regressor, source/provenance validator, participant/text split integrity, manifest/metrics, paired feedback/blind-review araçları, Kaggle notebooks ve statik validator.
- Tests: JS contract/unit suite, SQL integration fixture'ları, ML unittest suite ve deployment/security/retention testleri.

### Doğrulama durumu

Commit `5a2a7fa6dcf8f7991c050d528dcaef993f66e5ca` üzerinde görünen GitHub CI `web` check'i başarılı. Bu sonuç; lint/test/typecheck/build ve CI içindeki PostgreSQL fixture'larını doğrular, ancak hosted Supabase'ye migration uygulandığını, pg_cron job'larının çalıştığını, gerçek Hugging Face modelinin servise hazır olduğunu veya gerçek tarayıcı E2E akışlarını kanıtlamaz. `20261023193000_stage5_1_memory_retention_cron.sql` stock pgvector CI image'ında çalışan bir cron job olarak test edilmez; canlı Supabase'de `cron.job` ve `cron.job_run_details` ile ayrıca doğrulanmalıdır.

### Önerilen onarım sırası

1. AUD-01: DB write trust boundary (service-only chat persistence + tablo izinleri).
2. AUD-02 ve AUD-03: request idempotency ledger + profil sürüm/yarış kontrolü.
3. AUD-04: memory source owner trigger/FK ve eski RPC yolunun kapatılması.
4. AUD-05: katı embedding doğrulama ve adversarial shape testleri.
5. AUD-06: ölçülmüş/bounded retention ve cap migration planı.
6. AUD-13: silme nesli/generation ile chat-write yarışı.
7. AUD-09/AUD-10/AUD-11: workflow parser ve supply-chain/reproducibility.
8. AUD-08/AUD-12/AUD-14/AUD-15: PII/redaksiyon, bilimsel validity, perf ve filtre kalibrasyonu.
9. Sonrasında iki ayrı authenticated test hesabıyla RLS, doğrudan PostgREST yazma girişimi, kullanıcı silme yarışı, aynı idempotency key ile eşzamanlı chat, gerçek model canary ve gerçek tarayıcı E2E senaryoları.

## Nihai karar

**NO-GO — canlı production yayını için henüz onay verilmemeli.** Önce AUD-01/AUD-02/AUD-03/AUD-04 düzeltmeleri uygulanmalı ve regresyon testleri CI'ye eklenmeli. Ardından gerçek Supabase migration/cron doğrulaması ve kontrollü browser/model E2E yapılmalı. Mevcut CI yeşili önemlidir ama tek başına üretim güvenliği veya bilimsel geçerlilik kanıtı değildir.
