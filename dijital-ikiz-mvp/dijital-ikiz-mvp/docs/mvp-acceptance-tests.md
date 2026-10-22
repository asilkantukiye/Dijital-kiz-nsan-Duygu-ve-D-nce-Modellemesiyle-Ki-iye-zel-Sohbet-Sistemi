# MVP Kabul Testleri

Bu liste yazılımın çalıştığını göstermek için kullanılabilir.

## Kimlik doğrulama

- [ ] Yeni kullanıcı kayıt olabilir.
- [ ] E-posta doğrulaması açıksa kullanıcı bilgilendirilir.
- [ ] Mevcut kullanıcı giriş yapabilir.
- [ ] Oturum yokken ana uygulama giriş ekranını gösterir.
- [ ] Çıkış yapınca oturum kapanır.

## Sohbet

- [ ] Oturum açmış kullanıcı mesaj gönderebilir.
- [ ] Boş mesaj gönderilemez.
- [ ] 4000 karakterden uzun mesaj reddedilir.
- [ ] Kontrol karakterleri güvenli biçimde temizlenir.
- [ ] LLM yanıtı arayüzde görünür.
- [ ] Kişiselleştirilmiş ve genel test varyantları arasında geçiş yapılabilir.
- [ ] Bir varyantın konuşma geçmişi diğer varyanta karışmaz.
- [ ] Son konuşma bağlamı sonraki istekte kullanılır.
- [ ] Konuşma geçmişinin modele aktarılan toplam boyutu sınırlandırılır.
- [ ] Sayfa yenilendiğinde kayıtlı sohbet geçmişi yüklenir.

## Dijital ikiz profili

- [ ] İlk mesajdan sonra profil oluşturulur.
- [ ] Sonraki mesajlar önceki profile göre ağırlıklı güncelleme yapar.
- [ ] Profil değerleri 0–1 aralığında kalır.
- [ ] Profil göstergeleri arayüzde görünür.
- [ ] Profilin deneysel olduğu açıkça belirtilir.
- [ ] Baseline koşulu kişiselleştirilmiş profil durumunu güncellemez.
- [ ] Kişiselleştirilmiş koşulda yalnızca sınırlı ve türetilmiş bellek adayları kaydedilir.
- [ ] Bellek adayları yüksek riskli/sır niteliğindeki terimleri içermemelidir.
- [ ] Benzer bellekler embedding similarity ile geri çağrılabilir.
- [ ] Memory retrieval/persistence hatası sohbet yanıtını bozmaz.

## Veri güvenliği

- [ ] Supabase RLS açık olmalıdır.
- [ ] Kullanıcı yalnızca kendi mesaj ve profil kayıtlarına erişmelidir.
- [ ] API istekleri aktif oturum olmadan reddedilmelidir.
- [ ] Chat ve feedback gibi tarayıcı mutasyon API'leri farklı Origin değerleriyle reddedilmelidir.
- [ ] HF token yalnızca sunucu ortamında tutulmalıdır.
- [ ] `.env.local` Git'e gönderilmemelidir.
- [ ] API yanıtlarında `Cache-Control: no-store` bulunmalıdır.
- [ ] API istek limiti test edilmelidir.
- [ ] Rate-limit belleği sabit üst sınırı aşmamalıdır.
- [ ] Sağlayıcı hata gövdeleri kullanıcıya taşınmamalıdır.
- [ ] Kullanıcı "Verilerimi sil" işlemi ile kendi verilerini silebilmelidir.
- [ ] Asistan yanıtlarına 1–5 puan verilebilir.
- [ ] Geri bildirimler doğru varyant bilgisiyle saklanmalıdır.
- [ ] Kullanıcı/sağlayıcı metinleri sistem talimatı gibi yorumlanmamalıdır.
- [ ] Memory RPC yalnızca aktif kullanıcının kayıtlarını döndürmelidir.
- [ ] Kullanıcı verilerini silme işlemi memory_items kayıtlarını da silmelidir.

## Dağıtım

- [ ] `/api/health` 200 döndürmelidir; bu yalnızca servisin yanıt verdiğini gösterir.
- [ ] `/api/health` yanıtındaki `ready`, yalnızca Supabase URL + publishable key ve HF token yapılandırmalarının üçü de varsa `true` olmalıdır.
- [ ] `/api/health` yanıtında anahtar/token değerleri bulunmamalıdır.
- [ ] Vercel üzerinde build başarıyla tamamlanmalıdır.
- [ ] Vercel dağıtımının `READY` olması tek başına Supabase sohbet akışının uçtan uca çalıştığını kanıtlamaz; gerçek oturumla ayrıca denenmelidir.
- [ ] Supabase URL ve publishable key doğru ayarlanmalıdır.
- [ ] Hugging Face Inference Providers tokenı doğru ayarlanmalıdır.

## Ar-Ge

Bu test listesi yazılım doğrulamasıdır. Duygu/kişilik modellerinin bilimsel doğruluğu ayrıca etiketli veri ve ayrı test seti ile ölçülmelidir.

## Stage 5.1 canlı E2E kabul prosedürü (bloklayıcı kapı)

Bu bölüm, otomatik CI testlerini tekrar etmek yerine **aktif Supabase projesi üzerinde yapılacak manuel kabul testlerinin** sırasını ve başarı ölçütlerini sabitler. Canlı veritabanı kontrol edilene kadar testlerin durumu `BLOCKED` kalmalıdır; bu durum başarısızlık veya migration'ların uygulanmadığı anlamına gelmez.

### Canlı testleri başlatma ön koşulları

- [ ] Supabase Dashboard'da doğru proje referansı `yaryteseqvmyvapyppmy` doğrulandı.
- [ ] Proje etkin ve maliyet/plan bilgisi gözden geçirildi. Proje `INACTIVE` ise burada dur; yalnızca test yapmak için maliyetini anlamadan Restore/Resume seçme.
- [ ] Yerel proje klasöründe `supabase migration list --linked` başarıyla çalıştı. `LOCAL` ve `REMOTE` çıktıları saklandı; sekiz migration dosyası karşılaştırıldı. Özellikle `20261021210000` ve `20261021211000` uzak tarafta doğrulanmadan devam etme.
- [ ] Aşağıdaki runbook'taki salt-okunur sorgularla `replace_my_memory_preference` RPC'si, yürütme izinleri, `extensions` şema `USAGE` izni ve ilgili RLS politikaları doğrulandı.
- [ ] İki ayrı, yalnızca teste ayrılmış Supabase Auth kullanıcısı (A ve B) hazırlandı. Gerçek kullanıcıların verileri kullanılmayacak. Parola, token veya e-posta adresi test raporuna yazılmayacak.
- [ ] Test, mevcut dağıtımın tam URL'sinde yapılıyor; URL, commit SHA ve test tarihi kaydedildi. `/api/health` kontrolü tek başına E2E başarı sayılmaz.

**Yasak/kaçınılacak işlemler:** `supabase db push`, `supabase db reset`, `supabase migration repair`, canlı şema düzenleme ve mevcut kullanıcı verileri üzerinde silme testi. Migration durumu belirsizse testleri `BLOCKED` bırak ve tahminle ilerleme. `SUPABASE_PRODUCTION_SCHEMA_VERIFIED=true` yalnızca tüm canlı kontroller gerçekten geçtikten sonra ayarlanabilir.

### Senaryo 1 — Oturum açma ve ilk sohbet

1. Oturum açmamış bir pencerede ana sayfayı aç; korunan uygulama giriş ekranına yönlendirmeli ve sohbet API'si yetkisiz isteği reddetmeli.
2. Test kullanıcısı A ile giriş yap. Bir benzersiz, zararsız mesaj gönder; asistan yanıtının görünmesini ve sohbetin kaydolmasını doğrula.
3. Sayfayı yenile. A'nın kayıtlı sohbet geçmişi yüklenmeli ve kronolojik sırada görünmeli.
4. A'dan çıkış yap; oturumun kapandığını ve korunan sayfanın artık erişilebilir olmadığını doğrula.
5. Ayrı tarayıcı profili veya gizli pencere kullanarak kullanıcı B ile giriş yap ve A'dan farklı bir test mesajı gönder. B'nin kendi sohbeti yüklenmeli.

**PASS ölçütü:** A ve B ayrı oturumlarda çalışır; yenileme geçmişi kaybettirmez; oturum olmadan korunan sohbet kullanılamaz.

### Senaryo 2 — Kullanıcılar arası RLS izolasyonu

1. A ve B'nin farklı, benzersiz test mesajları gönderdiğini doğrula.
2. A oturumundayken arayüzde yalnızca A'nın mesajları, profili ve belleği görünmeli. B oturumunda yalnızca B'nin kayıtları görünmeli.
3. A oturumundan B'ye ait bir mesaj/bellek kimliği kullanılarak veri okumayı veya değiştirmeyi dene. İstek veri döndürmemeli veya değişiklik yapmamalı; benzer şekilde B'nin A verileri için denemesi de engellenmeli.
4. Canlı şemada RLS'nin açık olduğunu ve bellek RPC'sinin yalnızca `auth.uid()` kullanıcısının kayıtlarını döndürdüğünü runbook'taki salt-okunur kontrollerle doğrula.

**PASS ölçütü:** İki yönlü çapraz kullanıcı erişimi reddedilir; diğer kullanıcının kayıt sayısı ve içeriği değişmez. Bir güvenlik ihlali görülürse testi durdur ve hata kanıtını gizli veri içermeden kaydet.

### Senaryo 3 — Bellek oluşturma ve açık tercih güncellemesi

1. Yalnızca test kullanıcısı A ile kişiselleştirilmiş sohbet koşulunda şu tür zararsız bir tercih bildir: `Şekersiz kahve içiyorum.`
2. Uygulamanın sınırlı bir preference bellek adayı kaydedebildiğini kontrol et.
3. Ardından tercihi açıkça değiştir: `Artık şekerli kahve içiyorum.`
4. Tercih güncellemesinden sonra yeni tercih tutulmalı; eski çelişkili tercih ve aynı konuya ait yinelenen eski satırlar kalmamalı. İlgisiz bir tercih (ör. yeşil çay) silinmemeli.
5. Gerekiyorsa, Dashboard SQL Editor'da yalnızca SELECT sorgusu kullanarak A'nın test kayıtlarını doğrula:

   ```sql
   select id, memory_type, content, importance, created_at, updated_at
   from public.memory_items
   where user_id = '<TEST_USER_A_UUID>'
     and memory_type = 'preference'
   order by updated_at desc;
   ```

   `<TEST_USER_A_UUID>` değerini gerçek, özel test hesabının UUID'siyle değiştir. Bu sorgu salt okunurdur; doğrudan SQL ile kayıt ekleme, güncelleme veya silme yapma.

**PASS ölçütü:** Açık tercih değişikliği mevcut kaydı güvenli biçimde değiştirir; ilgisiz tercihler korunur; B'nin kayıtları etkilenmez.

### Senaryo 4 — Geri bildirim

1. A ile kendi asistan yanıtına 1–5 aralığında puan ver.
2. Geri bildirimin doğru mesaj kimliği, kullanıcı sahipliği ve deney varyantıyla saklandığını doğrula.
3. B'ye ait mesaja puan vermeyi ve mesajla uyuşmayan bir varyantla geri bildirim göndermeyi test ortamında dene; ikisi de reddedilmeli.

**PASS ölçütü:** Kendi uygun asistan mesajına geçerli geri bildirim kaydolur; başka kullanıcıya ait mesaj veya yanlış varyant kabul edilmez.

### Senaryo 5 — Verilerimi sil (son test)

> **Yıkıcı uygulama işlemi:** Bu senaryo yalnızca özel test hesabı A'da ve diğer senaryolar tamamlandıktan sonra çalıştırılır. Gerçek kullanıcı hesabında deneme.

1. A'da sohbet, bellek, profil ve mümkünse geri bildirim kayıtları oluşturulduğunu doğrula.
2. Uygulamadaki `Verilerimi sil` akışını kullan ve arayüzde istenen açık onayı ver.
3. A'nın `memory_items`, `twin_profiles`, `messages` ve ilişkili `message_feedback` kayıtlarının temizlendiğini doğrula.
4. B ile tekrar giriş yapıp B'nin mesajlarının, belleğinin ve geri bildirimlerinin korunduğunu doğrula.
5. Bu akış sohbet verilerini siler; Supabase Auth hesabının da silindiğini varsayma.

**PASS ölçütü:** A'nın ilgili uygulama verileri silinir, B'nin verileri değişmeden kalır ve arayüz sonucu açıkça bildirir. Gerçek veriler silinirse test durdurulur ve olay olarak raporlanır.

### Sonuç kaydı

Her senaryo için yalnızca `PASS`, `FAIL` veya `BLOCKED` işaretle; çalıştırılmamış testi `PASS` olarak işaretleme.

| Alan | Kaydedilecek değer |
|---|---|
| Proje referansı | `yaryteseqvmyvapyppmy` doğrulandı / edilmedi |
| Canlı migration listesi | Çalışma zamanı, çıktı konumu ve sekiz sürümün sonucu |
| Stage 5.1 migration'ları | `20261021210000` ve `20261021211000` için ayrı sonuç |
| RPC, RLS ve izin kontrolleri | PASS / FAIL / BLOCKED |
| E2E senaryoları 1–5 | Her biri için PASS / FAIL / BLOCKED |
| Dağıtım | Test edilen URL ve commit SHA |
| Son karar | Tüm zorunlu senaryolar geçmeden üretim hazır sayılmaz |

Canlı şema doğrulaması, iki kullanıcıyla izolasyon testi ve E2E kabul senaryoları tamamlanmadan Stage 5.1 mühürlenmiş sayılmaz ve Stage 6'ya geçilmez.

