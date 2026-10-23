# Stage 5.1 kontrollü rollback planı

Bu dosya bir “hepsini DROP et” betiği değildir. Aşağıdaki adımlar yalnız sorumlu mühendis onayı, doğru Supabase project ref kontrolü ve snapshot/backup doğrulaması sonrasında uygulanmalıdır. Production deploy ve migration geri alma birbirinden ayrı kararlardır.

## 0. Hemen önce

1. Yeni deploy’u durdur; GitHub repository variable `SUPABASE_PRODUCTION_SCHEMA_VERIFIED` değerini kaldır veya `false` yap. Bu değişken yalnız gerekli migration’ların ve permission kontrollerinin doğrulandığı zaman `true` olmalıdır.
2. Aktif deployment SHA’sını kaydet. Sorun yeni uygulama kodundaysa önce Vercel’de son bilinen iyi deployment’a dön; veritabanını refleks olarak geri alma.
3. Supabase Dashboard’da project ref ve region’ı iki kez doğrula. İşlem öncesi restore edilebilir backup/snapshot durumunu kaydet.
4. Aşağıdaki sorgularla iki cron job’ın kimliğini, sahibi ve schedule’ını kaydet. Başka role ait job’ları kaldırma.
5. Secrets veya kişisel veri içeren query output’larını GitHub loglarına/kayıtlarına kopyalama.

## 1. Sadece cron işlerini durdurma

Retention ve cap-cleanup job’larını schedule eden role ile çalıştır:

~~~sql
select cron.unschedule(jobid)
from cron.job
where jobname in (
  'stage5-memory-retention-cleanup',
  'stage5-memory-cap-cleanup'
)
and username = current_user;
~~~

Bu, silinmiş memory kayıtlarını geri getirmez; yalnız gelecekteki cron execution’larını durdurur. Retention işini durdurmak, veri saklama politikasındaki silme yükümlülüğünü de durdurduğu anlamına gelmez. Job owner farklıysa doğru role geçmeden genel bir unschedule çalıştırma.

## 2. Sadece 50 kayıt trigger davranışını geri alma

~~~sql
drop trigger if exists memory_items_cap_before_insert on public.memory_items;
drop function if exists public.enforce_memory_item_cap_before_insert();
drop index if exists public.memory_items_user_updated_cap_idx;
~~~

Bu, yeni insertlerde hard cap’i devre dışı bırakır; daha önce silinmiş overflow kayıtlarını geri getirmez. Bu adımı yalnız cap trigger’ının uygulama davranışını bozduğu kanıtlanırsa kullan. Retention cron job’ları ayrı bir kararla yönetilir.

## 3. Yeni tercih RPC’sini devre dışı bırakma

Önce app deployment’ını önceki bilinen iyi sürüme al. Şema değişikliği başarılı olduysa aşağıdaki adımlar RPC’yi kaldırabilir; fakat tercih anahtarı kolonunu otomatik silme.

~~~sql
revoke execute on function public.upsert_my_memory_preference(
  text, uuid, uuid[], text, real, extensions.vector, uuid
) from authenticated;

drop function if exists public.upsert_my_memory_preference(
  text, uuid, uuid[], text, real, extensions.vector, uuid
);

drop index if exists public.memory_items_user_preference_key_uidx;
~~~

**memory_items.preference_key kolonunu ve içindeki değerleri hemen DROP etme.** Yeni sürüm satırlara key yazdıktan sonra kolonu silmek kalıcı metadata kaybı doğurur. Eski app bu nullable kolonu kullanmadığından additive kolonun kalması genellikle daha güvenli geriye dönüş yoludur. Constraint kaldırma veya kolon silme ancak veri export/backup, eski sürüm compatibility ve yeniden migration planı değerlendirildikten sonra yapılmalıdır.

## 4. Migration yarıda kalmış gibi görünürse

- CI veya migration client hata verdi diye migration hiç uygulanmadı varsayma.
- `supabase migration list --linked`, `information_schema`, `pg_proc`, `pg_trigger`, `pg_indexes` ve `cron.job` üzerinden gerçek durum belirlenmeli.
- Beklenen DDL eksik ama migration geçmişi applied görünüyorsa migration history’yi körlemesine repair etme. Önce gerçek şema diff’ini ve ilgili statement’ın transaction davranışını belirle.
- Şema ve data durumları tutarsızsa sırf dosyayı yeniden çalıştırmak yerine snapshot restore veya forward-fix migration kararını ver.
- Uygulama rollback’i ve schema rollback’i ayrı change/review gerektirir.

## 5. Yeniden açma kriteri

- Sebep kök-neden analiziyle yazıldı.
- CI migration, SQL integration tests, typecheck ve build tekrar geçti.
- İki authenticated kullanıcıyla RLS/tercih/cap testleri geçti.
- pg_cron job’ları doğru role ve schedule ile yeniden doğrulandı.
- Production deployment önce staged oluşturuldu, /api/health ve /api/health/deep geçti, ardından reviewer onayıyla promote edildi.
- SUPABASE_PRODUCTION_SCHEMA_VERIFIED sadece bu koşullar sağlandığında yeniden `true` yapılır.
