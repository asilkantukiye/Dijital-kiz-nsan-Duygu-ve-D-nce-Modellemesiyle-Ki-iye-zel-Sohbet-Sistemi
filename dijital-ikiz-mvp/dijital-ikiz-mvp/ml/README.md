# Ar-Ge Modelleme Hattı

Bu klasör, MVP'deki heuristic profilden gerçek ölçülebilir makine öğrenmesi modellerine geçiş için ayrılmıştır.

## Veri şeması

Önerilen ana kayıt:

- `sample_id`
- `participant_id`
- `text`
- `source`
- `license_or_consent`
- `valence`
- `arousal`
- `dominance`
- `openness`
- `conscientiousness`
- `extraversion`
- `agreeableness`
- `neuroticism`
- `style_informality`
- `style_emoji_rate`
- `style_slang_rate`
- `style_humor`

## Veri toplama ilkeleri

Gerçek kullanıcı verisi kullanılacaksa:

1. kaynak/lisans veya açık rıza belgelenmelidir,
2. kimlik belirleyici bilgiler ayrıştırılmalıdır,
3. mümkünse kullanıcı kimliği yerine rastgele bir `sample_id` tutulmalıdır,
4. çocuk verileri için ayrıca gerekli izin ve etik süreçler tamamlanmalıdır.

Sentetik test satırları yalnızca kod doğrulaması içindir; gerçek kullanıcı verisi, model eğitimi veya bilimsel sonuç olarak raporlanmamalıdır.

## VAD etiketleme

VAD sürekli skorlar olarak 0–1 aralığına normalize edilebilir:

- valence: olumlu ↔ olumsuz,
- arousal: sakin ↔ yoğun/uyarılmış,
- dominance: kontrolsüz/çekingen ↔ baskın/kendinden emin.

Tercihen aynı örnek birden fazla değerlendirici tarafından bağımsız etiketlenmeli ve değerlendiriciler arası uyum raporlanmalıdır.

## Big Five etiketleme

Kişilik etiketlerinin tahmini için metin sahibinden doğrulanmış bir kişilik ölçeği sonucu alınması, metin örnekleriyle eşleştirilmesi ve eğitim/test ayrımının kişi bazında yapılması önerilir.

Aynı kişinin metinleri eğitim ve test kümelerine karıştırılmamalıdır; aksi durumda kişiye özel bilgi sızıntısı oluşabilir.

## Veri doğrulama ve bölme

Önce veri şeması kontrol edilir:

```bash
python ml/data/validate_dataset.py ml/data/your_dataset.csv
```

Doğrulayıcı zorunlu alanları, kaynak/lisans bilgisini, boş ve yinelenen kimlikleri denetler. Etiketlerin sayısal, sonlu ve 0–1 aralığında olmasını zorunlu tutar; `NaN`, `inf` veya `-inf` değerleri kabul etmez.

Ardından katılımcı bazlı bölme yapılır:

```bash
python ml/data/split_by_participant.py ml/data/your_dataset.csv ml/data/splits
```

Bölücü aynı katılımcıyı yalnızca bir bölüme yerleştirir. Train/validation/test dosyalarının üçünü de üretir ve en az üç farklı katılımcı ister; küçük veri kümelerinde oranlar yaklaşık olabilir. Eğitim betiği, dosyalar arasında örnek veya katılımcı sızıntısı bulursa eğitime başlamadan durur.

Bu kontroller ve sentetik fixture testleri standart Python kütüphanesiyle çalışır; GitHub Actions içindeki unittest keşfiyle otomatik doğrulanır.

## Deney düzeni

Minimum deney:

- train,
- validation,
- test.

Ayrı bir kullanıcı test kümesi tutulmalıdır.

Duygu modeli için sürekli VAD tahmininde MAE/RMSE ve korelasyonlar; sınıflandırılmış bir varyantta accuracy, precision, recall ve F1 kullanılabilir.

Big Five için boyut bazında regresyon hatası/korelasyon veya sınıflandırma kullanılıyorsa macro-F1 raporlanmalıdır.

%75 hedefi ancak hangi metrik ve test protokolünde ölçüldüğü açıklandıktan sonra raporlanmalıdır.

## Kaggle başlangıç komutları

Bağımlılık kurulumu:

```bash
pip install -r ml/requirements.txt
```

VAD eğitimi:

```bash
python ml/train_regressor.py \
  --train ml/data/splits/train.csv \
  --validation ml/data/splits/validation.csv \
  --test ml/data/splits/test.csv \
  --labels valence arousal dominance \
  --model dbmdz/bert-base-turkish-cased \
  --output artifacts/vad
```

Big Five için aynı eğitim altyapısı:

```bash
python ml/train_regressor.py \
  --train ml/data/splits/train.csv \
  --validation ml/data/splits/validation.csv \
  --test ml/data/splits/test.csv \
  --labels openness conscientiousness extraversion agreeableness neuroticism \
  --model dbmdz/bert-base-turkish-cased \
  --output artifacts/big-five
```

Bu komutların ürettiği `metrics.json`, deney günlüğüne eklenmelidir. Sonuçlar çalıştırılmadan önceden doldurulmamalıdır.


## Türkçe duygu polaritesi pilotu

Notebook: `ml/kaggle/sentiment_baseline.ipynb`.

Bu ayrı pilot, Hugging Face üzerinde CC BY-SA 4.0 olarak sunulan [winvoker Türkçe duygu analizi veri kümesini](https://huggingface.co/datasets/winvoker/turkish-sentiment-analysis-dataset) kullanır. Veri kümesinde olumlu, nötr ve olumsuz etiketler vardır. Model BERTurk tabanlı üç sınıflı sınıflandırıcıdır ve test accuracy, macro-F1, weighted-F1, sınıf bazlı precision/recall/F1 ile confusion matrix üretir.

Bu görev **VAD regresyonundan ve Big Five kişilik tahmininden ayrıdır**. Polarite sınıflandırması, arousal/dominance ölçümü veya kişi düzeyinde dijital ikiz tutarlılığı olarak sunulamaz. Kaynak veride katılımcı kimlikleri olmadığından bu pilot örnek düzeyinde değerlendirilir; yinelenen metinlerin train-test arasında bulunması engellenir. Eğitimden önce veri kartı ve kaynakların kullanım koşulları kontrol edilmeli; veri atfı ve CC BY-SA koşulları korunmalıdır.

Notebook veri dosyalarını sabitlenmiş veri sürümünden indirir, küçük bir pilot örneklemi ile modeli eğitir ve gerçek çalıştırmadan sonra `metrics.json` üretir. CI yalnızca notebook sözdizimini kontrol eder; Kaggle eğitimini otomatik çalıştırmaz ve model başarısı iddiası oluşturmaz.


## Kullanıcı puanlarıyla kişiselleştirme karşılaştırması

Uygulama asistan yanıtlarına 1–5 puan verebilir ve mesaj varyantını `personalized` veya `baseline` olarak saklar. Puanlar toplandıktan sonra analiz aracı, aynı takma kimlik altında her iki koşulu da puanlayan katılımcıların koşul ortalamalarını karşılaştırır:

```bash
python ml/analyze_feedback.py ml/data/anonymized_feedback.csv --output ml/results/feedback_analysis.json
```

Girdi CSV'si `participant_id,variant,rating` kolonlarını ister; isteğe bağlı `message_id` yinelenen puanları denetlemek için kullanılabilir. `participant_id` ham Supabase `user_id` olmamalı, önceden takma ada çevrilmelidir. Mesaj metnini, yorumları, e-postayı veya başka doğrudan tanımlayıcı bilgileri dışa aktarma ya da GitHub'a yükleme. `ml/data/feedback_template.csv` yalnızca boş şablondur; gerçek sonuç veya gerçek kullanıcı verisi değildir.

Rapor; koşul başına puanlı katılımcı sayısını, katılımcı ortalamalarını, eşleştirilmiş ortalama farkını, bootstrap %95 güven aralığını ve iki taraflı işaret-değiştirme permütasyon testini üretir. 15 veya daha az eşleştirilmiş katılımcıda permütasyon testi tam hesaplanır; daha fazlasında sabit tohumlu Monte Carlo yaklaşımı kullanılır.

**Önemli sınır:** Koşullar rastgele ve aynı istemlerle atanmadıkça bu keşifsel karşılaştırma nedensel bir A/B testi değildir. Puanlar algılanan yanıt kalitesini ölçer; VAD/Big Five doğruluğunu veya psikolojik faydayı kanıtlamaz. Gerçek veri yoksa sentetik testlerden proje sonucu çıkarılmaz.


## Kullanıcı değerlendirmesi protokolü

Önceden tanımlı keşifsel karşılaştırma, gönüllü katılım, anonimleştirme, aynı istemleri iki koşulda deneme ve sonuç sınırları için [deney protokolüne](ml/EXPERIMENT_PROTOCOL.md) bak. Bu belge gerçek katılımcı verisi veya sonuç içermez.


## Kaggle eğitiminin GitHub Actions üzerinden başlatılması

`.github/workflows/kaggle-sentiment-pilot.yml` yalnızca `workflow_dispatch` ile çalışır. Repository secrets içinde `KAGGLE_USERNAME` ile birlikte `KAGGLE_API_TOKEN` (tercih edilen) veya legacy `KAGGLE_KEY` tanımlıysa seçilen Kaggle GPU ile notebook'u gönderir, tamamlanmasını bekler ve modeli/gerçek `metrics.json` çıktısını Actions artifact'ine yükler. GPU kotası harcamamak için push, PR veya normal CI tetikleyicileri bu workflow'u başlatmaz.

Notebook çıktısı ancak gerçek Kaggle çalıştırması başarıyla biterse oluşur. Otomatik statik kontrollerin yeşil olması modelin eğitildiği anlamına gelmez.


## Görev bazlı veri doğrulama

VAD, Big Five ve üslup etiketleri ayrı veri kümelerinde bulunabileceğinden doğrulayıcı görev bazlı çalışır:

```bash
python ml/data/validate_dataset.py ml/data/vad.csv --task vad
python ml/data/validate_dataset.py ml/data/big_five.csv --task big-five
python ml/data/validate_dataset.py ml/data/style.csv --task style
```

Hiçbir görev seçilmezse varsayılan `all` seçeneği bütün hedef kolonlarını ister. Her görev ortak kimlik, metin, kaynak ve lisans/rıza açıklaması kolonlarını yine zorunlu tutar. Bu alanları doldurmak, kaynağın kullanım şartlarının ayrıca doğrulanması gereğini ortadan kaldırmaz.

`sentiment_baseline.ipynb` sonuç paketini `artifacts/sentiment/` klasörünü koruyarak oluşturur; Kaggle Actions aynı ZIP içindeki `sentiment/metrics.json` yolunu doğrular. Bu iki yol arasındaki uyum otomatik testle kontrol edilir.


## Regresyon ölçümleri ve basit referans modeli

VAD/Big Five/üslup regresyon eğitim betiği her hedef için MAE, RMSE, R², Pearson korelasyonu ve Spearman sıra korelasyonunu raporlar. Hedef veya tahmin sütunu sabitse korelasyonun matematiksel olarak tanımsız olması nedeniyle değer `null` olur; JSON'a NaN yazılmaz.

Test sonucunun tek başına iyi olup olmadığını anlamak için ayrıca basit bir referans model kullanılır: her hedefte yalnızca **train** bölümünün ortalamasını tahmin eden model. `metrics.json` hem eğitilmiş modelin hem bu referansın test metriklerini ve `mae_improvement_over_train_mean_baseline` farkını içerir. Pozitif fark modelin MAE açısından referansı geçtiğini; negatif fark ise geçemediğini gösterir. Bu fark bir başarı yüzdesi değildir.

Kullanım parametreleri için `epochs`, `batch-size`, `max-length` ve `learning-rate` pozitif değerlerle doğrulanır. Ölçüm yardımcı fonksiyonu standart Python kütüphanesiyle test edilebilir; CI bu testlerde GPU veya büyük dil modeli indirmeden çalışır.


## Veri toplama ve etiketleme yönergesi

VAD, Big Five ve üslup için ayrı, boş CSV şablonları `ml/data/vad_template.csv`, `ml/data/big_five_template.csv` ve `ml/data/style_template.csv` dosyalarındadır. Etiketleme ölçekleri, anonimleştirme, izin/lisans gereksinimleri, kişi bazlı bölme ve raporlama asgari koşulları `ml/DATA_ANNOTATION_GUIDE.md` içinde açıklanmıştır. Şablonlarda kasıtlı olarak hiç veri satırı yoktur; sentetik test verileri gerçek eğitim verisi veya sonuç yerine kullanılamaz.


## Veri kaynağı uygunluk denetimi

Kamuya açık veri adaylarının görev uyumu, lisans/erişim durumu ve açık koşulları `ml/DATASET_SOURCE_AUDIT.md` içinde kayıtlıdır. Lisans belirsizliği olan veya erişimi kapalı kaynaklar otomatik olarak kullanılabilir kabul edilmemelidir.


## Kör insan değerlendirmesi için A/B yanıt paketi

Aynı takma vaka anahtarına bağlı, aynı isteme ait bir `personalized` ve bir `baseline` yanıt için `ml/prepare_blind_review.py` kullanılır. Araç rastgele A/B etiketleri atar, vaka sırasını karıştırır ve değerlendiriciye gönderilebilecek bir paket ile ayrı bir koşul anahtarı üretir.

```bash
python ml/prepare_blind_review.py ml/data/blind_review_input.csv \
  --review-output ml/results/blind_review.csv \
  --key-output ml/private/condition_key.csv
```

Kaynak CSV sütunları `pair_id,participant_id,prompt_text,response_text,variant` olmalıdır. Başlamak için boş `ml/data/blind_review_input_template.csv` dosyasını kullan; gerçek yanıtları içeren dosyayı Git'e ekleme. `pair_id` ham kullanıcı kimliği değil, aynı katılımcı/istem çiftini eşleyen rastgele takma vaka anahtarıdır. Değerlendirici dosyası koşul etiketini ve kaynak kimliğini içermez; `ml/private/condition_key.csv` gizli tutulmalı ve değerlendiriciye verilmemelidir. Anahtar, raporda katılımcı düzeyinde kümelenmiş analiz için takma `participant_id` değerini içerir. Araç eksik koşul, aynı çiftte farklı istem veya yinelenen varyant varsa durur; var olan çıktı dosyasının üstüne varsayılan olarak yazmaz.

Puanlama rubric'i ve raporlama sınırları `ml/BLIND_REVIEW_RUBRIC.md` dosyasındadır. Bu araç insan değerlendirmesi hazırlamayı kolaylaştırır; mevcut canlı arayüzün koşul etiketini otomatik gizlediğini iddia etmez. Boş puan formu `ml/data/blind_review_rating_template.csv` dosyasındadır; her A/B yanıtını ayrı satır olarak değerlendir ve `case_id,response_label` eşleşmesini koru.


Kör puanlar için boş form `ml/data/blind_review_rating_template.csv` dosyasındadır. Koşul açıldıktan sonra puan analizi:

```bash
python ml/analyze_blind_review.py \
  ml/results/blind_review_ratings.csv \
  ml/private/condition_key.csv \
  --output ml/results/blind_review_analysis.json
```

Analiz değerlendiricilerin puanlarını önce aynı yanıt/vaka düzeyinde ortalar, ardından aynı katılımcının her iki koşulda da puanlanmış aynı istemleri üzerinden eşleştirilmiş farkı hesaplar. Eksik koşul puanını başka istemin puanıyla ikame etmez. Rapor kimlikleri ve metinleri dışarı vermez; üç rubrik ölçütünün p-değerleri için Holm düzeltmesi ve birden fazla değerlendirici varsa ölçüt başına ortalama ikili quadratic weighted Cohen kappa özeti içerir. Bu uyum özeti, rater dağılımı ve ortak puanlı vaka sayısıyla birlikte yorumlanmalıdır.


## Uygulama sohbet dışa aktarımını kör değerlendirmeye hazırlama

Yetkili olarak dışa aktardığın `messages` CSV'si için şu sütunlar gerekli: `id,user_id,role,variant,content,created_at`. Dönüştürücü yerel dosyadaki ham `user_id` değerlerini yalnızca bellekte gruplama için kullanır; dışa aktardığı dosyada geri döndürülemez şekilde takma ada çevirir. Bunun için en az 32 baytlık özel bir ortam değişkeni şarttır; aynı araştırma boyunca aynı tuz değerini çevrimdışı ve gizli tut.

Linux/macOS örneği:

```bash
export BLIND_REVIEW_PSEUDONYM_SALT='buraya-guclu-ve-gizli-en-az-32-baytlik-deger'
python ml/export_chat_pairs_for_blind_review.py ml/data/supabase_messages_export.csv \
  --output ml/data/blind_review_input.csv
python ml/prepare_blind_review.py ml/data/blind_review_input.csv \
  --review-output ml/results/blind_review.csv \
  --key-output ml/private/condition_key.csv
```

PowerShell örneği:

```powershell
$env:BLIND_REVIEW_PSEUDONYM_SALT = "buraya-guclu-ve-gizli-en-az-32-baytlik-deger"
python ml/export_chat_pairs_for_blind_review.py ml/data/supabase_messages_export.csv --output ml/data/blind_review_input.csv
```

Dönüştürücü yalnızca her iki koşulda da **aynı metin istemi** bulunan, tam user→assistant çiftlerini eşleştirir. Aynı katılımcı bir istemi birkaç kez yazmışsa oluşum sırasına göre eşleştirir. Zaman damgası aynıysa, sıra belirsizse veya eksik çift oluşmuşsa tahmin yürütmez ve hata verir. `--since` kullanırken tam bir çiftin ortasından başlamamaya dikkat et.

**Gizlilik:** Ham dışa aktarma, üretilen sohbet metinli CSV ve koşul anahtarı kişisel veri içerebilir. Bunları Git'e gönderme; `.gitignore` bu yerel dosyaları dışarıda bırakır. Bu araç yalnızca izinli/etik onaylı araştırma verileriyle, kısıtlı erişimli bir yerel ortamda kullanılmalıdır. Eski kayıtların zaman damgaları eşitse araç onları bilerek reddeder; yeni zaman damgalarının uygulama sürümü dağıtıldıktan sonra üretilen tam kayıtları seç.


## Kaynak/lisans alanı eğitim öncesi zorunluluğu

Hem `validate_dataset.py` hem de `train_regressor.py` artık her split satırında `source` ve `license_or_consent` ister. Boş alanlar ile `unknown`, `bilinmiyor`, `not verified`, `TBD` gibi yer tutucu durumlar reddedilir; eğitim kaynağı hakkında kanıt yokken eğitim sessizce başlamaz.

Bu kontrol lisansın hukuken geçerli olduğunu **kanıtlamaz**. Veri sahibinin şartları, birleşik veri kümesindeki alt kaynaklar ve gerekli onam/etik süreçler yine araştırmacı tarafından ayrıca doğrulanmalıdır.


## Eğitim koşusu tekrarlanabilirlik manifesti

`train_regressor.py` tarafından üretilen `metrics.json`, artık train/validation/test dosyalarının SHA-256 özetlerini, split boyutlarını, benzersiz örnek/katılımcı sayılarını ve hedef kolonlarını içerir. Ayrıca Python, NumPy, pandas, PyTorch ve Transformers sürümleri raporlanır. Kaynak/lisans değerlerinin kendileri, örnek metinleri veya katılımcı kimlikleri rapora kopyalanmaz.

Model deposunun değişmez commit SHA'sını doğruladıktan sonra aynı ağırlıkları yeniden kullanmak için `--model-revision` verilebilir. Örnek komut ve manifestin kapsamı için [tekrarlanabilirlik notlarına](ml/REPRODUCIBILITY.md) bak. Revision verilmezse raporda bu bilgi `null` görünür. SHA-256 dosya bütünlüğünü eşleştirmeye yarar; anonimleştirme, lisans doğrulaması veya eğitim başarısı kanıtı değildir.
