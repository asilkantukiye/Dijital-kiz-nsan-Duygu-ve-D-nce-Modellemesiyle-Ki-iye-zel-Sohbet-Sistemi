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

Migration'lar bu sırayla eksik olanlardan başlayarak uygulanmalıdır. Mevcut proje geçmişindeki applied/pending durumuna göre karar ver; her dosyayı sırf listede olduğu için yeniden uygulamak zorunlu değildir.

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
  and table_name in ('twin_profiles', 'messages', 'message_feedback', 'memory_items')
order by table_name;
~~~

### RLS etkinliği

~~~sql
select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('twin_profiles', 'messages', 'message_feedback', 'memory_items')
order by c.relname;
~~~

Dört tabloda da rls_enabled = true beklenir.

### Politika kontrolü

~~~sql
select tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('twin_profiles', 'messages', 'message_feedback', 'memory_items')
order by tablename, policyname;
~~~

message_feedback politikası, satırın imzalı kullanıcının kendi satırı olmasının yanında referans verilen mesajın aynı kullanıcıya ait bir assistant mesajı olmasını ve varyantın eşleşmesini de zorlamalıdır.

### Kritik fonksiyonlar ve güvenlik modu

~~~sql
select p.proname,
       pg_get_function_identity_arguments(p.oid) as arguments,
       p.prosecdef as security_definer,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('match_memory_items', 'delete_my_chat_data', 'persist_chat_turn', 'replace_my_memory_preference')
order by p.proname;
~~~

Uygulama fonksiyonları SECURITY INVOKER olarak tasarlanmıştır; bu yüzden security_definer = false, authenticated_can_execute = true ve anon_can_execute = false beklenir. `anon_can_execute = false` aynı zamanda PUBLIC üzerinden yanlışlıkla verilmiş execute iznini de yakalamaya yardımcı olur.

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
2. Salt-okunur kontrollerde RLS/politikaları, `match_memory_items`, `delete_my_chat_data`, `persist_chat_turn` ve `replace_my_memory_preference` fonksiyonlarını/izinlerini; ayrıca `authenticated` rolünün `extensions` şeması için `USAGE` iznini tekrar doğrula.
3. GitHub'daki CI başarısını şema doğrulamasıyla karıştırma: CI SQL sözleşmelerini/testleri kontrol eder, gerçek Supabase projesinde migration uygulandığını kanıtlamaz.
4. Oturum açma, iki kullanıcı arasında veri izolasyonu, sohbet kaydetme/okuma, geri bildirim yetkilendirmesi ve veri silme işlemini iki ayrı test hesabıyla dene. Bu E2E testleri yalnızca proje etkin ve migration'lar doğrulandıktan sonra yapılabilir.
5. Test hesabında veri silmenin chat belleğini, profili, mesajları ve bağlı geri bildirimi temizlediğini kontrol et. Bu işlem Supabase Auth hesabını silmez.
6. Yukarıdaki doğrulamaların tümü doğru projede tamamlandıktan sonra GitHub repository **Settings → Secrets and variables → Actions → Variables** bölümünde `SUPABASE_PRODUCTION_SCHEMA_VERIFIED` değişkenini tam olarak `true` yap. Yalnızca son chat-turn migration'ının uygulanması yeterli değildir; temel şema, listedeki bütün gerekli migration'lar, RLS politikaları ve tüm kritik RPC fonksiyonları/izinleri doğrulanmış olmalıdır. Proje INACTIVE ise veya bu kontrollerden biri belirsizse değişkeni oluşturma ya da `true` yapma.
