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
| Test ve değerlendirme | `ml/tests/`, `tests/`, `ml/analyze_feedback.py`, kör değerlendirme araçları | 27.10.2026 tarihli gerçek Kaggle koşusu polarite ve Qwen QLoRA metriklerini üretti; PostgreSQL/Node testleri, TypeScript ve build CI'da geçti. Kontrollü kullanıcı/A-B değerlendirmesi henüz yapılmadı. |

## Aşama 1 — çalışan ve ölçülebilir altyapı

- Giriş ekranı kaldırılır; istemci anonim Supabase oturumu oluşturur. API kullanıcı kimliğini sunucu tarafından doğrulamaya devam eder ve RLS koruması korunur.
- Tek Kaggle notebook'u kullanılır: Türkçe polarite + Qwen3-4B QLoRA talimat ince ayarı; VAD ve Big Five ayrı hedefler olarak yalnızca uygun etiketli CSV sağlanırsa çalışır.
- Polarite pilotunda normalize edilmiş birebir metin çakışmaları eğitim bölümünden çıkarılır ve sabit tohumlu train/validation/test alt örnekleri kullanılır. Bu birleşik duygu veri kümesinde participant_id bulunmadığından katılımcı bazlı sızıntı denetlenemez; aynı kaynak veya benzer metin türünden örnekler farklı split'lerde bulunabilir. VAD/Big Five CSV'lerinde participant_id varsa tüm katılımcı kayıtları tek split'te tutulmalıdır.
- Her görev kendi metriklerini, veri sürümünü/hash'ini, ortam bilgilerini ve bilimsel sınırlılıklarını ayrı `metrics.json` ile raporlar.
- `.github/workflows/kaggle-end-to-end-training.yml` manuel olarak başlatıldığında GitHub Actions Kaggle notebook'unu GPU ve Internet açık şekilde gönderip çalıştırır, sonucu bekler, model paketini indirir ve gerçek `metrics.json` dosyalarını kontrol eder. Önceki manuel **Prepare Kaggle Model Training** + Kaggle **Run All** yolu yedek olarak kalır.
- İsteğe bağlı Hugging Face yayımlama adımı, ölçüm dosyaları olan Qwen3-4B LoRA adaptörünü özel bir Hub deposuna yükler. Bu işlem tam birleştirilmiş model veya çalışan inference endpoint'i oluşturmaz; Vercel uygulamasının mevcut `HF_MODEL` ayarını otomatik değiştirmez. Gerçek metrik oluşmadan model yayımlama adımı çalışmaz.

**Doğrulanan durum (29.10.2026):** [Kaggle run 40897581853](https://github.com/asilkantukiye/Dijital-kiz-nsan-Duygu-ve-D-nce-Modellemesiyle-Ki-iye-zel-Sohbet-Sistemi/actions/runs/40897581853) başarıyla tamamlandı; artefakt digest doğrulandı. Polarite için 15.000/3.000/3.000, Qwen için 1.498/150/250 kodlanmış train/validation/test örneği raporlandı. [Yayınlama run 40915013003](https://github.com/asilkantukiye/Dijital-kiz-nsan-Duygu-ve-D-nce-Modellemesiyle-Ki-iye-zel-Sohbet-Sistemi/actions/runs/40915013003) ikinci denemede başarılı oldu; özel LoRA, `training-metrics.json` ve `scientific-validation-report.md` Hugging Face'e yüklendi. Canlıya alma ve kontrollü kullanıcı değerlendirmesi hâlâ ayrı kapılardır.

## Aşama 2 — gerçek bilimsel veri ve model doğrulama

1. **Polarite pilotu çalıştırıldı, ancak sonuç ön pilot olarak ele alınmalı.** Sabitlenmiş `winvoker/turkish-sentiment-analysis-dataset` revizyonundaki test ölçümü accuracy 0,9407, macro-F1 0,9407, weighted-F1 0,9407; çoğunluk sınıfı baseline accuracy 0,3333 ve macro-F1 0,1667. Dataset README'si nötr sınıfta Wikipedia ve rastgele metin örnekleri olduğunu belirtiyor; bu kaynak/tür ipuçları skoru yükseltebilir. Kaynak-tutulan veya bağımsız doğal sohbet test kümesi ve TF-IDF + LogisticRegression karşılaştırması olmadan bu sonucu genelleştirilmiş duygu doğruluğu olarak sunma. CC BY-SA 4.0 beyanı ve alt kaynak şartları ayrıca denetlenmeli.
2. **Qwen3-4B QLoRA pilotu çalıştırıldı.** `TFLai/Turkish-Alpaca` revizyonu `90f9589` için temel model test loss 2,3596, ince ayarlı model test loss 1,4867 oldu. Test kaybı iyileşmesi sohbet kalitesi veya kişilik/duygu başarısı kanıtı değildir; veri alt kaynakları ve lisans şartları ayrıca incelenmeli.
3. VAD için her örneği açık yönergeyle puanlayan yeterli ve izinli Türkçe veri oluşturulur; mümkünse iki bağımsız değerlendirici ve uyum analizi eklenir.
4. Big Five için metinden kişilik etiketi tahmin edilmez; gerekli katılımcı onamı ve Türkçe geçerliği/kullanım şartı doğrulanmış ölçek skorları kullanılır.
5. Her hedef için bağımsız test ve uygun metrik uygulanır. Polarite doğruluğu, VAD başarısı veya Big Five başarısı olarak sunulmaz.

**Durdurma kuralı:** Doğrulanmış uygun veri yoksa o görev eğitilmiş gibi gösterilmez; etiketi uydurulmuş ya da lisans durumu belirsiz veri eklenmez.

**Kaynak geçerliliği kapısı:** Veri kümesinin açıklaması sınıflar arasında farklı kaynak/genre dağılımı olabileceğini veya nötr sınıfın Wikipedia/rastgele metin içerdiğini söylüyorsa, aynı kaynaktan alınan rastgele test split'i tek başına yeterli değildir. En az bir source-heldout veya bağımsız gerçek sohbet değerlendirmesi gereklidir; bu tamamlanana kadar skorlar yalnızca bu pilot korpus için raporlanır.

### Mevcut ölçüm ve kalan kanıtlar

- Gerçek Kaggle ölçümleri: `docs/kaggle-training-results-2026-10-27.md`.
- Polarite/Qwen eğitim çıktıları doğrulandı; VAD ve Big Five bu koşuda etiketli, izin/lisansı doğrulanmış CSV olmadığı için çalıştırılmadı.
- Qwen LoRA özel Hugging Face deposuna yüklendi ve yayınlama job'ı dosya/manifest/rapor kontrolüyle başarılı oldu. Bu, uygulamaya inference entegrasyonu yapıldığı anlamına gelmez; uygulamanın `HF_MODEL` ayarı hâlen temel Qwen modelidir.
- Vercel production dağıtımı, environment variable'lar ve canlı sağlık kontrolü bu denetimde yetki erişimi nedeniyle doğrulanamadı; canlıya alma tamamlanmış kabul edilmemelidir.
- Genel sohbet ve kişiselleştirilmiş sohbet için kullanıcı/uzman kör değerlendirmesi, önceden belirlenmiş kalite ölçütleri ve istatistiksel A/B sonucu hâlâ gereklidir.

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
