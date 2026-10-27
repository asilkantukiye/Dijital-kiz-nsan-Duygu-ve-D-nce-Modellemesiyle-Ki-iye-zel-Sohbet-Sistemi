# TÜBİTAK 2204-A — uygulama ve araştırma yol haritası

## Proje amacı

“Dijital İkiz İnsan: Duygu ve Düşünce Modellemesiyle Kişiye Özel Sohbet Sistemi”, Türkçe metinlerden ölçülebilir duygu, ifade biçimi ve uygun koşullarda kişilik göstergeleri çıkararak genel sohbet ile kişiselleştirilmiş sohbeti kontrollü bir deneyde karşılaştırmayı amaçlar.

Finalist olma sonucu garanti edilemez. Projenin özgün katkısı, doğrulanabilir veri/izin zinciri, sızıntısız test ve raporlanabilir deney sonuçlarıyla gösterilmelidir.

## Raporun beş basamağı ile kod eşleştirmesi

| Rapor basamağı | Depodaki karşılık | Mevcut durum |
|---|---|---|
| Veri toplama, ön işleme, etiketleme | `ml/data/`, `DATA_ANNOTATION_GUIDE.md`, `DATASET_SOURCE_AUDIT.md` | Doğrulama ve boş şablonlar hazır; VAD/Big Five için uygun gerçek etiketli veri henüz eklenmedi. |
| Duygu ve kişilik modelleri | `ml/kaggle/dijital_ikiz_training.ipynb`, `ml/train_regressor.py` | Tek Kaggle notebook'u Türkçe polarite modelini ve Qwen3-4B QLoRA talimat pilotunu eğitir. VAD/BF yalnızca kendi hedef etiketleri olan doğrulanmış CSV eklenirse eğitilir. |
| Üslup modellemesi | `lib/twin.ts`, `ml/data/style_template.csv` | Uygulamada heuristic başlangıç; öğrenilmiş/kalibre edilmiş model değil. |
| Kişiye özel sohbet motoru | `app/api/chat/route.ts`, `lib/huggingface.ts`, `lib/twin.ts` | Qwen sohbet motoru var; profil özellikleri henüz deneysel baseline. |
| Test ve değerlendirme | `ml/tests/`, `tests/`, `ml/analyze_feedback.py`, kör değerlendirme araçları | Otomatik testler var; gerçek eğitim metrikleri ve kullanıcı değerlendirmesi henüz elde edilmedi. |

## Aşama 1 — çalışan ve ölçülebilir altyapı

- Giriş ekranı kaldırılır; istemci anonim Supabase oturumu oluşturur. API kullanıcı kimliğini sunucu tarafından doğrulamaya devam eder ve RLS koruması korunur.
- Tek Kaggle notebook'u kullanılır: Türkçe polarite + Qwen3-4B QLoRA talimat ince ayarı; VAD ve Big Five ayrı hedefler olarak yalnızca uygun etiketli CSV sağlanırsa çalışır.
- Train/validation/test ayrımı katılımcı ve normalize edilmiş metin sızıntısını engeller.
- Her görev kendi metriklerini, veri sürümünü/hash'ini, ortam bilgilerini ve bilimsel sınırlılıklarını ayrı `metrics.json` ile raporlar.
- `.github/workflows/kaggle-end-to-end-training.yml` manuel olarak başlatıldığında GitHub Actions Kaggle notebook'unu GPU ve Internet açık şekilde gönderip çalıştırır, sonucu bekler, model paketini indirir ve gerçek `metrics.json` dosyalarını kontrol eder. Önceki manuel **Prepare Kaggle Model Training** + Kaggle **Run All** yolu yedek olarak kalır.
- İsteğe bağlı Hugging Face yayımlama adımı, ölçüm dosyaları olan Qwen3-4B LoRA adaptörünü özel bir Hub deposuna yükler. Bu işlem tam birleştirilmiş model veya çalışan inference endpoint'i oluşturmaz; Vercel uygulamasının mevcut `HF_MODEL` ayarını otomatik değiştirmez. Gerçek metrik oluşmadan model yayımlama adımı çalışmaz.

**Tamamlanma ölçütü:** CI, Python veri testleri, SQL entegrasyon testleri, TypeScript ve üretim derlemesi yeşil olmalı; notebook çıktısı gerçek Kaggle çalıştırmasından alınmalı.

## Aşama 2 — gerçek bilimsel veri ve model doğrulama

1. Polarite pilotu için kaynak/lisans şartları ve birleşik verinin alt kaynakları gözden geçirilir; test doğruluğu, macro-F1, weighted-F1 ve çoğunluk sınıfı baseline'ı raporlanır.
2. Qwen3-4B QLoRA pilotu, Apache-2.0 olarak işaretlenen Türkçe talimat veri kümesinde aynı bağımsız test bölümüyle temel modelin yanıt-token kaybına karşı değerlendirilir; veri kaynağı ve lisans beyanı ayrıca denetlenir.
3. VAD için her örneği açık yönergeyle puanlayan yeterli ve izinli Türkçe veri oluşturulur; mümkünse iki bağımsız değerlendirici ve uyum analizi eklenir.
4. Big Five için metinden kişilik etiketi tahmin edilmez; gerekli katılımcı onamı ve Türkçe geçerliği/kullanım şartı doğrulanmış ölçek skorları kullanılır.
5. Her hedef için bağımsız test ve uygun metrik uygulanır. Polarite doğruluğu, VAD başarısı veya Big Five başarısı olarak sunulmaz.

**Durdurma kuralı:** Doğrulanmış uygun veri yoksa o görev eğitilmiş gibi gösterilmez; etiketi uydurulmuş ya da lisans durumu belirsiz veri eklenmez.

## Aşama 3 — entegrasyon ve TÜBİTAK kanıt dosyası

- Eğitilen model, mevcut heuristic profilin yerine ancak model çıktıları ve dağıtım uyumluluğu doğrulandıktan sonra entegre edilir.
- Genel ve kişiselleştirilmiş koşullar aynı istemler üzerinde, önceden belirlenmiş ölçütlerle karşılaştırılır; örneklem, koşul sırası, eksik veriler ve sınırlılıklar raporlanır.
- Hız, hata oranı, bellek izolasyonu, yanıt kalitesi, veri izni, model sürümü, eğitim komutu ve metrik dosyaları kanıtlanabilir biçimde saklanır.
- Raporda “%75 başarı” ancak hangi görev, hangi metrik ve hangi bağımsız testle ölçüldüğü belirtilerek gerçek sonuç olarak yazılır.

## Etik ve güvenlik sınırları

- Kamuya açık veri, yalnızca kaynağın gerçek lisansı ve alt kaynak koşulları uygun olduğunda kullanılabilir.
- Gerçek konuşma, kimlik, ham kullanıcı ID'si, onam belgesi veya eşleştirme anahtarı GitHub'a yüklenmez.
- Reşit olmayanlarla araştırma veya psikososyal etki iddiaları için gerekli kurum/veli/onam ve uzman süreçleri tamamlanmadan kullanıcı deneyi yapılmaz.
- Sistem klinik değerlendirme ya da terapi aracı olarak sunulmaz.
- Anonim oturumlarda tarayıcı verisi silinirse aynı oturuma erişim kaybolabilir; bu davranış kullanıcıya bildirilmelidir.

## Resmî takvim

2026–2027 TÜBİTAK 2204-A duyurusunda başvuru son tarihi **4 Ocak 2027, 17.30** olarak belirtilmiştir. Son başvuru öncesinde güncel çağrı ve rehber yeniden kontrol edilmelidir:
- https://tubitak.gov.tr/tr/yarismalar/2204-a-lise-ogrencileri-arastirma-projeleri-yarismasi
- https://tubitak.gov.tr/sites/default/files/2026-09/lise_proje_rehberi_2027_onaya_sunulan.pdf
- https://tubitak.gov.tr/sites/default/files/2026-09/Ek-1b_2204_A_cagri_metni_2026-2027_17.08.2026_onaya_sunulan_v2.pdf
