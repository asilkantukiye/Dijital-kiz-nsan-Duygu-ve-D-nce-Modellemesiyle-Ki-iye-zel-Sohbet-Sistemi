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
