# Supabase migration ve geri yükleme kontrol listesi

Bu runbook, mevcut Supabase projesini kontrol etmek veya tekrar etkinleştirildikten sonra şemayı güvenli biçimde eşitlemek içindir. **Tek başına veritabanını etkinleştirmez, plan değiştirmez ve migration uygulamaz.**

## Önce doğru proje ve maliyet

- Repo'nun bağlı olduğu proje referansı: yaryteseqvmyvapyppmy, bölge: ap-southeast-1. SQL çalıştırmadan önce Supabase Dashboard'da aynı proje olduğunu doğrula.
- Proje durumu INACTIVE görünüyorsa yalnızca denetim yapmak için hemen Restore/Resume seçme; plan ve olası kullanım ücretlerini kontrol et.
- Üretim verisi içerebilecek bir projede migration çalıştırmadan önce mümkünse yedek/dışa aktarım al. Yedekleri GitHub'a, örnek veri CSV'lerine veya bu repoya koyma.
- Gizli anahtarlar, parolalar ve service-role key SQL dosyalarına ya da GitHub Actions loglarına yazılmamalıdır.

## Hangi yöntemi kullanmalı?

- **Yeni ve boş bir proje:** supabase/schema.sql mevcut uygulamanın toplu şemasını içerir. SQL Editor'da çalıştırmadan önce projenin gerçekten boş ve doğru hedef olduğundan emin ol. Sonraki CLI migration kullanımı için aşağıdaki migration geçmişi adımını da tamamla.
- **Daha önce kullanılmış proje:** schema.sql dosyasının tamamını körlemesine yeniden çalıştırma. Önce Dashboard/CLI üzerinden migration geçmişini incele; yalnızca uygulanmamış timestamp'li migration'ları sırasıyla uygula. Şema mevcut olsa bile migration geçmişi, migration'ın uygulandığını kanıtlayan ayrı bilgidir.
- **Migration geçmişi okunamıyorsa veya bağlantı zaman aşımına uğruyorsa:** sonucu “hiç migration uygulanmamış” olarak yorumlama. Yeniden bağlanınca geçmişi tekrar kontrol et; tahminle migration uygulama.

## Repo'daki timestamp'li migration sırası

Aşağıdaki sıralama dosya adlarına göredir. Gerçek projede her birinin uygulanıp uygulanmadığını ayrıca doğrula.

1. 20261008191854_rls_and_ab_performance_hardening.sql
2. 20261008202104_stage5_memory_engine.sql
3. 20261008202255_stage5_memory_fk_index.sql
4. 20261018190000_atomic_user_data_deletion.sql
5. 20261019175000_feedback_message_ownership_rls.sql
6. 20261020200000_atomic_chat_turn_persistence.sql
7. 20261021210000_stage5_memory_extensions_usage.sql
8. 20261021211000_stage5_atomic_memory_preference_update.sql
9. 20261023196000_aud_01_chat_write_boundary.sql
10. 20261023200000_aud_02_chat_deduplication.sql
11. 20261023210000_aud_03_concurrent_profile_updates.sql
12. 20261023220000_aud_04_memory_ownership_validation.sql
13. 20261023230000_aud_05_embedding_validation.sql
14. 20261023230500_aud_05_validate_embedding_integrity.sql
15. 20261023231000_aud_06_chat_deduplication_window.sql
16. 20261025170000_stage6_foreign_key_indexes.sql
17. 20261027171525_supabase_backed_chat_rate_limit.sql
18. 20261027181135_stage6_180_day_retention_cleanup.sql
19. 20261027181851_stage6_retention_inactivity_semantics.sql
20. 20261027182055_stage6_retention_index_cleanup.sql
21. 20261027200000_delete_my_chat_inflight_claims.sql

Migration'lar bu sırayla eksik olanlardan başlayarak uygulanmalıdır. Mevcut proje geçmişindeki applied/pending durumuna göre karar ver; her dosyayı sırf listede olduğu için yeniden uygulamak zorunlu değildir. Canlı migration geçmişi dosya önekleriyle farklı sürüm numaraları gösteriyorsa önce kayıtları dosya adları ve şema etkileriyle eşleştir; geçmişi körlemesine repair etme.

### Stage 6 FK performans indeksi

`20261025170000_stage6_foreign_key_indexes.sql`, chat idempotency kaydındaki `user_message_id` ve `assistant_message_id` alanlarına ayrı indeksler, ayrıca `memory_items(source_message_id, user_id)` bileşik indeksi ekler. Bu indeksler RLS veya tablo yetkilerini değiştirmez ve kayıt içeriğini silmez; PostgreSQL'in referanslanan mesaj silme/kontrol işlemlerinde çocuk kayıtları bulmasına yardımcı olur. Yeni migration, AUD-01–AUD-06 migration zincirinden sonra uygulanmalıdır. Canlı ortamda migration geçmişi dosya sürümleriyle hizalanmadan bu dosyayı uygulama.

## AUD-01: sohbet/profil yazma sınırı

`20261023196000_aud_01_chat_write_boundary.sql`, `authenticated` rolünden `messages` ve `twin_profiles` INSERT/UPDATE izinlerini kaldırır ve eski `persist_chat_turn` RPC'sini authenticated için kapatır. Yeni `persist_chat_turn_server` yalnızca `service_role` ile çağrılır. `/api/chat` önce `auth.getUser()` ile oturumu doğrular, kullanıcı kimliğini doğrulanmış oturumdan alır; istek gövdesindeki `user_id`/`session_id` reddedilir. Bu tasarım için `SUPABASE_SERVICE_ROLE_KEY` yalnızca Next.js sunucu ortamında tanımlanmalıdır. Bu değer kesinlikle `NEXT_PUBLIC_` ile başlamamalı veya tarayıcı bundle'ına eklenmemelidir.

Migration sonrası `tests/sql/chat_write_boundary.integration.sql` eşdeğeri kontrollerde authenticated rolünün `messages` ve `twin_profiles` INSERT/UPDATE yetkilerinin ve iki chat-writer RPC'si için EXECUTE yetkisinin bulunmadığını doğrula. Kendi mesajlarını okuma ve veri silme akışını ayrıca test et.

## AUD-02: aynı sohbet isteğini tekilleştirme

`20261023200000_aud_02_chat_deduplication.sql` ve `20261023231000_aud_06_chat_deduplication_window.sql`, doğrulanmış kullanıcı, varyant ve normalize edilmiş mesaj için SHA-256 parmak izi kullanır; ham mesaj metni idempotency tablosuna kopyalanmaz. `claim_chat_request_server` PostgreSQL tarafında atomik sahiplik alır. Tamamlanmış yanıt 10 saniye boyunca tekrar kullanılabilir; aktif isteğin lease'i beş dakika kalır; etkin istek için ikinci istek yeni model çağrısı başlatmaz ve `202` / `Retry-After` ile yeniden kontrol eder. Profil güncellemesi, kullanıcı/asistan mesaj çifti ve yanıt önbelleği `persist_chat_turn_idempotent_server` içinde tek bir transaction'da tamamlanır. `chat_request_deduplication` tablosu ve claim/release/writer RPC'leri yalnızca `service_role` içindir. Başarısız istek sahipliği `release_chat_request_server` ile bırakılır; claim işlemi eski önbellek kayıtlarını sınırlı sayıda temizler.

Migration sonrası `tests/sql/chat_idempotency.integration.sql` eşdeğeri kontrollerde ilk claim'in `claimed`, eşzamanlı tekrarın `in_progress`, tamamlanmış tekrarın `replay` döndürdüğünü; yanıt önbelleği ile mesaj çiftinin tek işlemde kaydedildiğini doğrula. CI başarısı canlı Supabase migration'ının uygulandığını kanıtlamaz.

## Migration geçmişini kontrol et

Supabase CLI kurulu ve doğru projeye bağlıysa:

~~~bash
supabase link --project-ref yaryteseqvmyvapyppmy
supabase migration list --linked
~~~

Bu komutlar doğru proje bağlamında çalışmalıdır. supabase link projeyi değiştirmez; ancak yanlış proje seçimi sonraki komutları yanlış hedefe yöneltebilir, bu nedenle ref'i kontrol et.

Bir migration dosyasını Dashboard SQL Editor'da elle çalıştırdıysan, CLI geçmişinde otomatik olarak applied görünmeyebilir. supabase migration repair --status applied <version> gibi bir geçmiş düzeltmesini **yalnızca ilgili migration etkileri veritabanında gerçekten doğrulandıktan sonra** uygula. Sırf pending listesini temizlemek için applied işaretleme.

## Migration öncesi salt-okunur kontroller

Doğru projede SQL Editor üzerinden aşağıdaki sorgular veriyi silmez veya şemayı değiştirmez.

### Gerekli tabloların varlığı

~~~sql
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('twin_profiles', 'messages', 'message_feedback', 'memory_items', 'chat_request_deduplication')
order by table_name;
~~~

### RLS etkinliği

~~~sql
select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('twin_profiles', 'messages', 'message_feedback', 'memory_items', 'chat_request_deduplication')
order by c.relname;
~~~

Beş tabloda da rls_enabled = true beklenir; `chat_request_deduplication` yalnızca sunucu rolü tarafından okunup yazılabilmelidir.

### Politika kontrolü

~~~sql
select tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('twin_profiles', 'messages', 'message_feedback', 'memory_items', 'chat_request_deduplication')
order by tablename, policyname;
~~~

message_feedback politikası, satırın imzalı kullanıcının kendi satırı olmasının yanında referans verilen mesajın aynı kullanıcıya ait bir assistant mesajı olmasını ve varyantın eşleşmesini de zorlamalıdır.

### Kritik fonksiyonlar ve güvenlik modu

~~~sql
select p.proname,
       pg_get_function_identity_arguments(p.oid) as arguments,
       p.prosecdef as security_definer,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute,
       has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_can_execute,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('match_memory_items', 'delete_my_chat_data', 'persist_chat_turn', 'persist_chat_turn_server', 'claim_chat_request_server', 'release_chat_request_server', 'persist_chat_turn_idempotent_server', 'merge_twin_profile_observation', 'replace_my_memory_preference')
order by p.proname;
~~~

Uygulama fonksiyonları SECURITY INVOKER olarak tasarlanmıştır. `match_memory_items`, `delete_my_chat_data` ve `replace_my_memory_preference` için authenticated EXECUTE beklenir; eski `persist_chat_turn` için authenticated EXECUTE **false** olmalı; yeni `persist_chat_turn_server` için authenticated ve anon EXECUTE **false**, service_role EXECUTE **true** olmalıdır. Service-role anahtarını SQL çıktılarına veya CI loglarına yazma. `anon_can_execute = false` aynı zamanda PUBLIC üzerinden yanlışlıkla verilmiş execute iznini de yakalamaya yardımcı olur.

### pgvector extension ve schema izni

~~~sql
select e.extname, n.nspname as extension_schema
from pg_extension e
join pg_namespace n on n.oid = e.extnamespace
where e.extname = 'vector';
~~~

Repo şeması vektör extension'ını `extensions` şemasında bekler. Ayrıca authenticated rolü bu şemayı kullanabilmelidir:

~~~sql
select has_schema_privilege('authenticated', 'extensions', 'USAGE')
  as authenticated_can_use_extensions;
~~~

Sorgu `true` döndürmelidir; bu izin tek başına tablo erişimi vermez ve RLS'yi devre dışı bırakmaz.

## Migration sonrası doğrulama

1. CLI migration listesinde beklenen migration'ların applied olduğunu doğrula.
2. Salt-okunur kontrollerde RLS/politikaları, `match_memory_items`, `delete_my_chat_data`, `persist_chat_turn`, `persist_chat_turn_server`, `claim_chat_request_server`, `release_chat_request_server`, `persist_chat_turn_idempotent_server` ve `replace_my_memory_preference` fonksiyonlarını/izinlerini; ayrıca `authenticated` rolünün `extensions` şeması için `USAGE` iznini tekrar doğrula.
3. GitHub'daki CI başarısını şema doğrulamasıyla karıştırma: CI SQL sözleşmelerini/testleri kontrol eder, gerçek Supabase projesinde migration uygulandığını kanıtlamaz.
4. Oturum açma, iki kullanıcı arasında veri izolasyonu, sohbet kaydetme/okuma, geri bildirim yetkilendirmesi ve veri silme işlemini iki ayrı test hesabıyla dene. Bu E2E testleri yalnızca proje etkin ve migration'lar doğrulandıktan sonra yapılabilir.
5. Test hesabında veri silmenin chat belleğini, profili, mesajları ve bağlı geri bildirimi temizlediğini kontrol et. Bu işlem Supabase Auth hesabını silmez.
6. Yukarıdaki doğrulamaların tümü doğru projede tamamlandıktan sonra GitHub repository **Settings → Secrets and variables → Actions → Variables** bölümünde `SUPABASE_PRODUCTION_SCHEMA_VERIFIED` değişkenini tam olarak `true` yap. Yalnızca son chat-turn migration'ının uygulanması yeterli değildir; temel şema, listedeki bütün gerekli migration'lar, RLS politikaları ve tüm kritik RPC fonksiyonları/izinleri doğrulanmış olmalıdır. Proje INACTIVE ise veya bu kontrollerden biri belirsizse değişkeni oluşturma ya da `true` yapma.


## AUD-03: eşzamanlı dijital ikiz profil güncellemeleri

`20261023210000_aud_03_concurrent_profile_updates.sql`, chat route'un eski profil üzerinden hesapladığı tam JSON görüntüsünü doğrudan yazmasını engeller. Route, yalnızca gelen mesajdan türetilen 13 sayısal profil gözlemini gönderir. `persist_chat_turn_idempotent_server` önce istek sahipliğini `FOR UPDATE` ile doğrular; ardından `twin_profiles(user_id)` üzerindeki benzersiz anahtarlı UPSERT ve `merge_twin_profile_observation` fonksiyonu, çakışan satır kilidi altında gözlemi en güncel kayda uygular. Böylece farklı mesajların eşzamanlı güncellemeleri eski snapshot ile birbirini ezmez.

Aynı PostgreSQL transaction'ında kanonik birleştirilmiş profil mesajların `profile_snapshot` alanına ve idempotency yanıtının `profile` alanına yazılır. Payload 13 bilinen alanı içermeli; tüm değerler sayısal ve 0–1 aralığında olmalıdır. Herhangi bir mesaj yazımı veya validasyon başarısız olursa profil, mesajlar ve cache birlikte rollback olur. `merge_twin_profile_observation` yalnızca `service_role` için çalıştırılabilir.

CI ayrıca `tests/profile-update-concurrency.integration.mjs` ile 13 farklı profil özelliğini aynı kullanıcı için paralel isteklerle günceller; her özelliğin son değerde temsil edildiğini, 13 mesaj çiftinin ve tamamlanmış istek kaydının bulunduğunu, profil snapshot'larının geçerli olduğunu ve 20 saniyelik işlem sınırında deadlock olmadığını kontrol eder. Bu entegrasyon testi canlı Supabase verisine dokunmaz; CI'nin kendi PostgreSQL 17 test veritabanını kullanır.

 
## AUD-04: memory source ownership validation

`20261023220000_aud_04_memory_ownership_validation.sql`, eski tek alanlı `memory_items.source_message_id → messages.id` yabancı anahtarını bileşik `(source_message_id, user_id) → (messages.id, user_id)` kuralıyla değiştirir. `messages(id,user_id)` için benzersiz anahtar eklenir. Böylece hem INSERT hem UPDATE sırasında bellek kaydının kullanıcısı ile kaynak mesajının kullanıcısı PostgreSQL tarafından aynı olmak zorundadır; RLS veya istemci doğrulamasından bağımsızdır. Migration, varsa kaynak mesajı başka kullanıcıya ait eski memory_items satırlarını temizler. Kaynak mesaj silinince yalnızca `source_message_id` NULL yapılır ve `user_id` korunur.

`lib/memory.ts`, memory okuma/yazma öncesi `auth.getUser()` ile verilen kullanıcı kimliğini doğrular. Yeni bellek eklemeden önce kaynak mesajın oturum sahibine ait olduğunu ve `role = 'user'` olduğunu da kontrol eder. Bunlar erken reddetme için ek savunmadır; yetkili güvenlik sınırı bileşik veritabanı yabancı anahtarıdır.

CI içindeki `tests/sql/memory_source_ownership.integration.sql`, geçerli A→A ve B→B ilişkilerini, A mesajını B kullanıcısına bağlama girişiminin `foreign_key_violation` ile reddedildiğini, bir satırın sahibini B'ye çevirmeye yönelik UPDATE girişiminin de reddedildiğini ve kaynak mesaj silinince memory sahipliğinin korunduğunu doğrular. `tests/sql/migration_catalog.integration.sql` bileşik anahtar ve seçici `ON DELETE SET NULL (source_message_id)` davranışının gerçekten kurulu olduğunu denetler.


## AUD-05 / AUD-06: vector integrity and bounded memory garbage collection

`20261023230000_aud_05_embedding_validation.sql` adds a database CHECK constraint as `NOT VALID`, requiring `vector(384)`, a positive vector norm, and a finite norm. The follow-up `20261023230500_aud_05_validate_embedding_integrity.sql` validates historical rows in a separate migration transaction, releasing the initial DDL lock before the table scan. `lib/embedding-validation.ts` rejects empty, wrong-dimension, non-numeric, null, NaN, infinite, zero and overflow-norm arrays before any pgvector RPC or write; token-level pooling no longer fabricates missing dimensions as zero. CI runs `tests/sql/memory_embedding_integrity.integration.sql` to prove the database rejects a zero vector.

`lib/memory.ts` now handles stale and over-cap cleanup in deterministic batches. Each request deletes at most four batches per category, reapplies stale predicates on DELETE to protect a concurrently used row, and leaves additional cleanup for later memory operations instead of running unbounded DELETE loops.


## AUD-06: completed chat deduplication replay window

`20261023231000_aud_06_chat_deduplication_window.sql` sets the completed-response replay window to 10 seconds. A database trigger applies the TTL atomically when a claim transitions to `completed`, and already-completed rows are shortened based on their original `updated_at`. The five-minute processing lease is deliberately unchanged: identical requests that arrive while inference is active remain `in_progress` and do not start a second model call. The PostgreSQL idempotency integration test asserts the completed cache expiry is positive and no more than 10 seconds.


## Stage 6: scheduled 180-day inactivity retention

`20261027181135_stage6_180_day_retention_cleanup.sql` initially introduced the hourly `pg_cron` job and bounded cleanup function. The follow-up `20261027181851_stage6_retention_inactivity_semantics.sql` aligns that job to the published privacy policy: it **does not delete conversation messages**. It deletes memory items only when they have not been used or updated for 180 days, expired/failed idempotency metadata after its replay window, and rate-limit counters whose windows ended more than two days ago.

The cleanup runs hourly at minute 17 UTC. Each invocation processes at most 20 batches of 1,000 rows per category and uses a transaction-scoped advisory lock to prevent overlapping cleanup runs. `backlog_remaining` reports whether eligible rows remain so a large backlog drains across later runs. The function is `SECURITY DEFINER` with a fixed search path; direct execution is revoked from `PUBLIC`, `anon`, and `authenticated`, and granted to `service_role`. Cron runs as the scheduling database owner.

The inactivity cutoff is based on memory `updated_at` and `last_used_at`; a memory that has been used recently is not removed merely because it was created over 180 days ago. Conversation history remains until the user explicitly deletes it. The job does not delete accounts, current twin profiles, experiment definitions, or evaluation metadata.


## Stage 6: chat silme ve devam eden istek yarışı

`20261027200000_delete_my_chat_inflight_claims.sql`, sohbet verisi silinirken model üretimi hâlâ sürmekte olan bir isteğin silme sonrasında yeniden mesaj/profil kaydetmesini önlemek için kullanıcı başına bir `chat_user_data_generations` sayacı kullanır.

- `/api/chat` sunucu tarafında kullanıcının mevcut generation değerini alır ve claim RPC'sine gönderir.
- Claim RPC generation satırına `FOR SHARE` kilidi alır; veriler silinirken aynı satır artırıldığı için claim ve silme işlemi sıralanır.
- `delete_my_chat_data()` aynı veritabanı transaction'ında önce generation değerini artırır ve yalnızca mevcut kullanıcının idempotency kayıtlarını kaldırır; sonra bellek, profil ve mesajları siler.
- Silmeden önce generation okumuş ama daha sonra claim almaya çalışan eski istek `P0409` ile reddedilir. Daha önce claim almış fakat üretimi sonradan tamamlanan eski istek, claim satırı artık bulunmadığından kaydetme aşamasında başarısız olur.
- Generation satırı bilerek korunur. Bu satır silinip sayaç sıfırlanırsa eski bir isteğin generation değeri tekrar geçerli hâle gelebilir.
- Yanıt kaydedildikten sonra çalışan bellek çıkarımı da aynı generation değerini taşır. `persist_my_memory_at_generation()` yalnızca `auth.uid()` kullanır, sabit `search_path` altında eski generation değerini reddeder ve bellek ekleme/upsert işlemini generation satırındaki `FOR SHARE` kilidiyle aynı transaction'da yapar. Böylece silme, sonradan tamamlanan embedding işinin yeni bir bellek kaydı oluşturmasını da engeller. Ayrıca bellek tablosunun INSERT/UPDATE RLS politikaları generation kontrolünü veritabanında zorunlu kılar; bu, dağıtım sırasında kısa süre çalışan eski bir uygulama örneğinin doğrudan upsert yapmasını da engeller. UPDATE politikası generation kilidini hedef bellek satırı kilitlenmeden alır; DELETE politikası ise kullanıcının eski generation'a ait kayıtları silmesine izin verir.
- `delete_my_chat_request_claims_for_current_user()` SECURITY DEFINER olmak zorundadır; argüman kabul etmez, `auth.uid()` ile güncel kullanıcıyı belirler, `search_path = pg_catalog, public` ile sınırlandırılır ve yalnızca authenticated/anon olmayan roller için uygun izinlerle açılır. Kullanıcı kimliği veya başka kullanıcının kimliği parametre olarak alınmaz.

Migration sonrası `tests/sql/data_deletion_idempotency.integration.sql` şu davranışları test eder: silmenin iki aktif claim'i kaldırması, aynı kullanıcı için eski generation ile yeni claim'in reddedilmesi, eski claim üzerinden geç gelen model yanıtının yazılamaması, güncel generation ile yeni bir claim'in çalışması ve başka bir kullanıcının claim'inin korunması. Test tüm fixture'ları transaction sonunda geri alır.

Canlı projede migration öncesi yedek ve migration geçmişi kontrolü yap; doğru migration sırasını doğrulamadan uygulama. CI testi tek başına canlı Supabase migration'ının uygulanmış olduğunu kanıtlamaz.
