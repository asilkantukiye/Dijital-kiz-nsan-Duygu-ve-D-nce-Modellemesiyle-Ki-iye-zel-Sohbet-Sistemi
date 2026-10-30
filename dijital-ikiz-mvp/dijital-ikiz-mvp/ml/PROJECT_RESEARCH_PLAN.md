# TÜBİTAK 2204-A — uygulama ve araştırma yol haritası

## Proje amacı

“Dijital İkiz İnsan: Duygu ve Düşünce Modellemesiyle Kişiye Özel Sohbet Sistemi” proje adı korunur; ancak **30.10.2026 itibarıyla aktif araştırma sorusu yalnızca gözlemlenebilir dil üslubu kişiselleştirmesidir**. Aynı temel sohbet modelinin genel yanıtları ile yalnızca üslup profili eklenmiş yanıtları, aynı Türkçe istemlerde kör değerlendiricilerle karşılaştırılır. Duygu tanıma, VAD, Big Five veya psikolojik durum çıkarımı mevcut deneyin hedefi değildir. Polarite ve QLoRA eğitim koşuları yardımcı teknik pilotlardır; kişiselleştirme başarısını veya psikolojik ölçüm geçerliliğini kanıtlamaz.

Finalist olma sonucu garanti edilemez. Projenin özgün katkısı, doğrulanabilir veri/izin zinciri, sızıntısız test ve raporlanabilir deney sonuçlarıyla gösterilmelidir.

## Raporun beş basamağı ile kod eşleştirmesi

| Rapor basamağı | Depodaki karşılık | Mevcut durum |
|---|---|---|
| Veri ve etiket hazırlığı | `ml/data/`, `DATA_ANNOTATION_GUIDE.md`, `DATASET_SOURCE_AUDIT.md` | Eğitim veri kaynağı, lisans, revizyon ve sızıntı kontrolleri için araçlar var. İnsan değerlendirmesi için gerçek puanlar henüz toplanmadı. |
| Yardımcı ML pilotları | `ml/kaggle/dijital_ikiz_training.ipynb`, `ml/train_regressor.py` | Türkçe polarite ve Qwen3-4B QLoRA pilotları çalıştırıldı. Bunlar aktif A/B araştırma sorusunun ana sonuçları değildir; VAD/Big Five model başarısı iddia edilmez. |
| Üslup profili | `lib/twin.ts`, `ml/data/style_template.csv` | Gözlemlenebilir yazı özelliklerine dayalı, el ile tanımlanmış sezgisel başlangıç profili; öğrenilmiş veya kalibre edilmiş model değildir. |
| Sohbet ve koşullandırma | `app/api/chat/route.ts`, `lib/huggingface.ts`, `lib/twin.ts` | Qwen sohbet sağlayıcısı ve profil koşullandırma altyapısı var. Özel LoRA adaptörü yayımlandı; çalışan üretim inference endpoint'i ve Vercel entegrasyonu henüz doğrulanmış değil. |
| Kör A/B değerlendirmesi | `scripts/run-style-ab-evaluation.mjs`, `ml/analyze_style_ab_scores.py`, `docs/style-ab-human-scoring-guide.md`, `ml/tests/` | 30 sentetik durum için kör paket ve koşul anahtarı üretilebilir; en az iki değerlendiricinin puanlarını istem kümeleri üzerinden analiz eden araç ve testler eklendi. Henüz insan puanı veya deney sonucu yok. |

## Aşama 1 — çalışan ve ölçülebilir altyapı

- Giriş ekranı kaldırılır; istemci anonim Supabase oturumu oluşturur. API kullanıcı kimliğini sunucu tarafından doğrulamaya devam eder ve RLS koruması korunur.
- Tek Kaggle notebook'u, yardımcı teknik pilotlar için Türkçe polarite ve Qwen3-4B QLoRA talimat ince ayarını çalıştırır. Bu koşular aktif üslup A/B araştırmasının yerine geçmez. VAD ve Big Five mevcut araştırma kapsamı dışındadır; ayrı bir araştırma sorusu, geçerli ölçüm aracı, veri/lisans incelemesi ve gerekli etik izinler olmadan bu görevler için eğitim başlatılmaz.
- Polarite pilotunda normalize edilmiş birebir metin çakışmaları eğitim bölümünden çıkarılır ve sabit tohumlu train/validation/test alt örnekleri kullanılır. Bu birleşik duygu veri kümesinde participant_id bulunmadığından katılımcı bazlı sızıntı denetlenemez; aynı kaynak veya benzer metin türünden örnekler farklı split'lerde bulunabilir. VAD/Big Five CSV'lerinde participant_id varsa tüm katılımcı kayıtları tek split'te tutulmalıdır.
- Her görev kendi metriklerini, veri sürümünü/hash'ini, ortam bilgilerini ve bilimsel sınırlılıklarını ayrı `metrics.json` ile raporlar.
- `.github/workflows/kaggle-end-to-end-training.yml` manuel olarak başlatıldığında GitHub Actions Kaggle notebook'unu GPU ve Internet açık şekilde gönderip çalıştırır, sonucu bekler, model paketini indirir ve gerçek `metrics.json` dosyalarını kontrol eder. Önceki manuel **Prepare Kaggle Model Training** + Kaggle **Run All** yolu yedek olarak kalır.
- İsteğe bağlı Hugging Face yayımlama adımı, ölçüm dosyaları olan Qwen3-4B LoRA adaptörünü özel bir Hub deposuna yükler. Bu işlem tam birleştirilmiş model veya çalışan inference endpoint'i oluşturmaz; Vercel uygulamasının mevcut `HF_MODEL` ayarını otomatik değiştirmez. Gerçek metrik oluşmadan model yayımlama adımı çalışmaz.

**Doğrulanan durum (29.10.2026):** [Kaggle run 40897581853](https://github.com/asilkantukiye/Dijital-kiz-nsan-Duygu-ve-D-nce-Modellemesiyle-Ki-iye-zel-Sohbet-Sistemi/actions/runs/40897581853) başarıyla tamamlandı; artefakt digest doğrulandı. Polarite için 15.000/3.000/3.000, Qwen için 1.498/150/250 kodlanmış train/validation/test örneği raporlandı. [Yayınlama run 40915013003](https://github.com/asilkantukiye/Dijital-kiz-nsan-Duygu-ve-D-nce-Modellemesiyle-Ki-iye-zel-Sohbet-Sistemi/actions/runs/40915013003) ikinci denemede başarılı oldu; özel LoRA, `training-metrics.json` ve `scientific-validation-report.md` Hugging Face'e yüklendi. Canlıya alma ve kontrollü kullanıcı değerlendirmesi hâlâ ayrı kapılardır.

## Aşama 2 — gerçek bilimsel veri ve model doğrulama

1. **Polarite pilotu çalıştırıldı, ancak sonuç ön pilot olarak ele alınmalı.** Sabitlenmiş `winvoker/turkish-sentiment-analysis-dataset` revizyonundaki test ölçümü accuracy 0,9407, macro-F1 0,9407, weighted-F1 0,9407; çoğunluk sınıfı baseline accuracy 0,3333 ve macro-F1 0,1667. Dataset README'si nötr sınıfta Wikipedia ve rastgele metin örnekleri olduğunu belirtiyor; bu kaynak/tür ipuçları skoru yükseltebilir. Kaynak-tutulan veya bağımsız doğal sohbet test kümesi ve TF-IDF + LogisticRegression karşılaştırması olmadan bu sonucu genelleştirilmiş duygu doğruluğu olarak sunma. CC BY-SA 4.0 beyanı ve alt kaynak şartları ayrıca denetlenmeli.
2. **Qwen3-4B QLoRA pilotu çalıştırıldı.** `TFLai/Turkish-Alpaca` revizyonu `90f9589` için temel model test loss 2,3596, ince ayarlı model test loss 1,4867 oldu. Test kaybı iyileşmesi sohbet kalitesi veya kişilik/duygu başarısı kanıtı değildir; veri alt kaynakları ve lisans şartları ayrıca incelenmeli.
3. VAD, aktif araştırma sorusunun parçası değildir. Bu sürümde VAD verisi üretme veya VAD başarısı iddia etme hedefi yoktur.
4. Big Five, aktif araştırma sorusunun parçası değildir. Metinden kişilik etiketi türetilmez; yeni ve ayrı bir protokol onaylanmadan kişilik tahmini modeli eğitilmez.
5. Aktif üslup A/B deneyi için birincil ölçüt kör üslup uyumu puanıdır; görev uygunluğu ve yanıt tutarlılığı ikincil tanımlayıcı ölçütlerdir. Polarite sınıflandırma skorları veya QLoRA test loss değeri kişiselleştirme başarısı yerine kullanılamaz.

**Durdurma kuralı:** Doğrulanmış uygun veri yoksa o görev eğitilmiş gibi gösterilmez; etiketi uydurulmuş ya da lisans durumu belirsiz veri eklenmez.

**Kaynak geçerliliği kapısı:** Veri kümesinin açıklaması sınıflar arasında farklı kaynak/genre dağılımı olabileceğini veya nötr sınıfın Wikipedia/rastgele metin içerdiğini söylüyorsa, aynı kaynaktan alınan rastgele test split'i tek başına yeterli değildir. En az bir source-heldout veya bağımsız gerçek sohbet değerlendirmesi gereklidir; bu tamamlanana kadar skorlar yalnızca bu pilot korpus için raporlanır.

### Mevcut ölçüm ve kalan kanıtlar

- Gerçek Kaggle ölçümleri: `docs/kaggle-training-results-2026-10-27.md`.
- Polarite/Qwen eğitim çıktıları doğrulandı; VAD ve Big Five bu koşuda etiketli, izin/lisansı doğrulanmış CSV olmadığı için çalıştırılmadı.
- Qwen LoRA özel Hugging Face deposuna yüklendi ve yayınlama job'ı dosya/manifest/rapor kontrolüyle başarılı oldu. Bu, uygulamaya inference entegrasyonu yapıldığı anlamına gelmez; uygulamanın `HF_MODEL` ayarı hâlen temel Qwen modelidir.
- Vercel production dağıtımı, environment variable'lar ve canlı sağlık kontrolü bu denetimde yetki erişimi nedeniyle doğrulanamadı; canlıya alma tamamlanmış kabul edilmemelidir.
- Genel sohbet ve kişiselleştirilmiş sohbet için kullanıcı/uzman kör değerlendirmesi, önceden belirlenmiş kalite ölçütleri ve istatistiksel A/B sonucu hâlâ gereklidir.

## 30.10.2026 — onaylı üslup A/B odağı ve Stage 6.2 durumu

- **Deney değişkeni:** aynı temel model, aynı model/LoRA sürümü, aynı istem ve aynı üretim parametreleri korunur. Tek kontrollü fark, kişiselleştirilmiş koşulda gözlemlenebilir üslup profilinin sistem mesajına eklenmesidir.
- **Sentetik teknik pilot:** `ml/evaluation/style-ab-cases.json` içinde üç sentetik üslup profiline yayılmış 30 istem vardır. Bu dosya insan katılımcı verisi değildir ve tek başına gerçek kullanıcı genellemesi sağlayamaz.
- **Kör üretim:** `scripts/run-style-ab-evaluation.mjs` iki koşul için aynı vaka-seed'ini kullanır; üretim ve sunum sırasını dengeli biçimde rastgeleleştirir. Koşul anahtarı ayrı tutulur.
- **Kör puanlama:** `docs/style-ab-human-scoring-guide.md` yönergesi ve `ml/evaluation/style-ab-score-template.csv` şablonu, her çiftin en az iki bağımsız değerlendirici tarafından 1–5 aralığında puanlanmasını tanımlar.
- **İstatistik:** `ml/analyze_style_ab_scores.py`, birincil üslup uyumu farkını tekrarlanan aynı istemleri kümelendirerek bootstrap %95 güven aralığı ve iki taraflı işaret-değiştirme permütasyon testiyle raporlar. Değerlendiriciler arası güvenilirlik katsayısı henüz hesaplanmaz; ayrı doğrulama gerekir.
- **Durum sınırı:** yazılım altyapısının eklenmesi insan değerlendirmesinin yapıldığı anlamına gelmez. Gerçek puanlar, gerekli kurum/öğretmen izinleri ve bilgilendirilmiş onam süreçleri tamamlanmadan toplanmaz. Bu tarihte insan puanı veya A/B etki sonucu bildirilmemiştir.
- **Canlı model sınırı:** özel LoRA adaptörünün Hugging Face'e yayımlanması, çalışan bir vLLM endpoint'inin oluşturulduğu veya Vercel uygulamasının bu adaptörü kullandığı anlamına gelmez. Ücretli GPU endpoint'i açıkça bütçe onayı ve çalışma zamanı doğrulaması olmadan açılmaz.

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


## 29.10.2026 TÜBİTAK uyum denetimi

Ayrıntılı çağrı şartları, kanıt durumu, rapordaki uyumsuzluklar ve önerilen deney planı `docs/tubitak-2027-compliance-review.md` belgesinde yer alır. En önemli yöntem kararı: olumlu/nötr/olumsuz polarite test skoru, VAD başarısı, Big Five başarısı veya kişiye özgü sohbet başarısı yerine kullanılamaz. Bu görevler ayrı etiketler, ayrı testler ve ayrı metrikler gerektirir.
