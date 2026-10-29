# TÜBİTAK Teslim Öncesi Kontrol

## 29 Ekim 2026 — doğrulanmış kanıtlar

- [x] Ana dal CI: PostgreSQL migration/entegrasyon testleri, embedding bütünlüğü, eşzamanlı profil güncellemeleri, eşzamanlı hız sınırı, birim testleri, TypeScript ve production build başarılı.
- [x] Canlı Supabase migration geçmişi 20261027200805_delete_my_chat_inflight_claims kaydını içeriyor; generation tablosu/alanları, RLS politikaları ve yeni RPC izinleri yeniden sorgulanarak doğrulandı.
- [x] Gerçek Kaggle eğitim koşusu başarıyla tamamlandı; model artefakt arşivi doğrulandı.
- [x] Polarite/Qwen eğitim sonuçları, split büyüklükleri, baseline ve bilimsel sınırlılıklar docs/kaggle-training-results-2026-10-27.md dosyasında kaydedildi.

- [x] Özel Qwen LoRA deposu yükleme sonrası doğrulandı: `hasankb00/dijital-ikiz-qwen3-4b-lora`; bilimsel rapor, metrikler ve manifest mevcut. Kaggle run `40897581853`; publisher run `40915013003`, attempt 2 sonucu başarılı.

Bu tamamlamalar, aşağıdaki tüm canlı uçtan uca testlerin, lisans incelemesinin, uygulama inference entegrasyonunun veya TÜBİTAK çalışmasının tamamlandığı anlamına gelmez.

## Yazılım ve canlı sistem

- [ ] GitHub deposunun gizli/private olduğu ve gizli anahtar içermediği yeniden doğrulandı.
- [ ] README kurulum ve hata giderme adımlarını içeriyor.
- [ ] .env.local Git'e eklenmiyor; server-only secret'lar istemci bundle'ına taşınmıyor.
- [x] npm run typecheck başarılı (ana dal CI).
- [x] npm run build başarılı (ana dal CI).
- [ ] Canlı /api/health 200 ve ready=true döndürüyor.
- [ ] Yeni silme-yarışı güvenlik kodunu içeren son commit canlı Vercel dağıtımında çalışıyor.
- [ ] İki ayrı deneme kullanıcısıyla oturum, sohbet, geçmişin yenilenmesi, geri bildirim ve silme uçtan uca test edildi.
- [ ] Anonim oturum silindiğinde erişimin kaybolabileceği kullanıcı arayüzünde açıkça bildiriliyor.
- [ ] Vercel deployment health ve upstream bağımlılık testi son kodla başarılı.

## Supabase

- [x] Canlı migration geçmişi ve kritik function/RLS katalogları sorgulanarak kontrol edildi.
- [x] 20261027200805_delete_my_chat_inflight_claims migration'ı uygulandı ve üretim şeması değişiklikleri doğrulandı.
- [ ] GitHub Actions repository variable SUPABASE_PRODUCTION_SCHEMA_VERIFIED, doğrulama kanıtı incelendikten sonra true olarak yazılıp geri okundu.
- [ ] İki ayrı deneme kullanıcısıyla canlı RLS veri izolasyonu doğrulandı.
- [ ] Leaked-password protection uyarısı uygun Supabase Auth ayarından ele alındı.
- [ ] Cron saklama işi için düzenli başarılı çalıştırma geçmişi gözden geçirildi; 180 günlük politika ve geriye dönük etkileri kayıt altına alındı.

## Yapay zekâ ve model yayımlama

- [x] Türkçe polarite modeli ve Qwen3-4B QLoRA için gerçek Kaggle eğitim metrikleri alındı.
- [ ] Polarite veri kümesinin lisansı ve birleşik veri alt kaynaklarının kullanım şartları belgeyle doğrulandı.
- [ ] Polarite testinde kaynak/genre karışıklığı riski için source-heldout veya bağımsız doğal Türkçe sohbet test kümesi üzerinde değerlendirme tamamlandı.
- [ ] BERTurk polarite modeli, aynı eğitim/test örnekleri üzerinde TF-IDF + LogisticRegression baseline ile karşılaştırıldı; sonuç rapora eklendi.
- [ ] Qwen temel model ve Türkçe talimat veri kümesinin lisans/alt kaynak şartları yeniden incelendi.
- [ ] HF_WRITE_TOKEN GitHub Actions secret'ı, yalnızca hedef özel model deposuna yazma yetkili ve kısıtlı bir token ile eklendi.
- [x] Gerçek LoRA artefaktı Hugging Face'e yüklendi; özel görünürlük, adaptör ağırlıkları, README, `training-metrics.json`, `scientific-validation-report.md` ve `artifact-manifest.json` doğrulandı. Kaynak artifact digest: `sha256:f143275dd908bf8b3273218601807ae626ada31343490acc0bce7bea5c9f8126`.
- [ ] Qwen LoRA adaptörü uyumlu inference yolunda doğrulandı; web uygulaması gerçekten bu adaptörü kullanmadıkça entegrasyon tamamlandı sayılmadı.
- [ ] Türkçe yanıt, timeout, 429/503, malformed output, uzun istek ve provider arızası canlı smoke testleri yapıldı.

## Ar-Ge ve TÜBİTAK kanıtı

- [x] Polarite görevine ait train/validation/test ayrımı, accuracy, macro-F1, weighted-F1, sınıf metrikleri ve majority baseline raporlandı.
- [x] Qwen görevi için train/validation/test örnek sayıları ve temel/ince ayarlı test loss raporlandı.
- [ ] VAD için izinli ve kaynak/lisansı doğrulanmış Türkçe etiketli veri sağlandı; ayrı test metriği üretildi.
- [ ] Big Five için doğrulanmış Türkçe ölçek/puan ve gerekli katılımcı onamı sağlandı; ayrı test metriği üretildi.
- [ ] Üslup modeli, heuristic profilden ayrı olarak etiketli veri üzerinde kalibre edildi veya açıkça baseline olarak bırakıldı.
- [ ] Genel sohbet ve kişiselleştirilmiş sohbet aynı prompt setinde karşılaştırıldı; değerlendirme ölçütleri, örneklem, kör puanlama ve istatistiksel analiz önceden belirlendi.
- [ ] TÜBİTAK raporundaki %75 hedefi belirli görev, metrik ve bağımsız test ile açıkça eşleştirildi.
- [ ] Sonuç bölümüne yalnızca yeniden üretilebilir gerçek deneyler eklendi; polarite skoru VAD/Big Five ya da sohbet kalitesi olarak sunulmadı.

## Etik ve gizlilik

- [ ] Her veri kaynağı için kullanım izni/lisans ve alt kaynak koşulları belgelenmiş.
- [ ] Gerçek kullanıcı konuşmaları, kimlikler, ham user ID'ler, onam belgeleri ve eşleştirme anahtarları GitHub'a yüklenmiyor.
- [ ] Katılımcı veya kullanıcı deneyinden önce gerekli onam/etik süreçler tamamlandı.
- [ ] Sistem klinik tanı veya terapi aracı olarak sunulmuyor.
- [ ] Saklama ve silme politikası kullanıcıya açıklanıyor; silme sonrasında eski isteklerin veri geri oluşturması test edilmiş.

## Dağıtım engelleri — açıkça çözümlenmeli

- [ ] Vercel build kotası engeli kalktıktan sonra son güvenlik commit'i üretime dağıtıldı ve smoke test edildi.
- [ ] GitHub repository variable yazma/yayını kapısı için gereken GH_VARIABLES_TOKEN secret'ı eklendi veya doğrulama sonrası variable manuel ayarlanıp geri okundu.
- [x] Hugging Face özel model deposuna yükleme başarılı; bu kontrol canlı uygulamanın LoRA'yı kullandığı anlamına gelmez.


## 29 Ekim 2026 — ek durum notları

- Yayınlama job'ı ilk denemede bilimsel doğrulama raporu beklenen çıktıda bulunmadığı için başarısız oldu. PR #149, raporun yayın klasörüne kopyalanmasını ve regresyon testini ekledi. Başarısız koşunun ikinci denemesi, aynı daha önceki Kaggle artifact'ını indirip doğrulayarak başarılı oldu; GPU eğitimi yeniden çalıştırılmadı.
- Vercel deployment/env erişimi bu denetimde yetki kısıtı nedeniyle doğrulanamadı. Canlı sağlık veya son commit'in production'da olduğu henüz işaretlenmemeli.
- Mevcut uygulamanın `HF_MODEL` ayarı temel Qwen modelini gösteriyor. Özel LoRA ancak uyumlu inference sunucusu veya doğrulanmış birleştirilmiş model kurulduktan sonra uygulamaya bağlanmış sayılır.
