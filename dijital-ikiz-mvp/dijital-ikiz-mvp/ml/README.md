# Ar-Ge Modelleme Hattı

Bu klasör, MVP'deki heuristic profilden gerçek ölçülebilir makine öğrenmesi modellerine geçiş için ayrılmıştır.

## Veri şeması

Önerilen ana kayıt:

- \`sample_id\`
- \`text\`
- \`source\`
- \`license_or_consent\`
- \`valence\`
- \`arousal\`
- \`dominance\`
- \`openness\`
- \`conscientiousness\`
- \`extraversion\`
- \`agreeableness\`
- \`neuroticism\`
- \`style_informality\`
- \`style_emoji_rate\`
- \`style_slang_rate\`
- \`style_humor\`

## Veri toplama ilkeleri

Gerçek kullanıcı verisi kullanılacaksa:

1. kaynak/lisans veya açık rıza belgelenmelidir,
2. kimlik belirleyici bilgiler ayrıştırılmalıdır,
3. mümkünse kullanıcı kimliği yerine rastgele bir \`sample_id\` tutulmalıdır,
4. çocuk verileri için ayrıca gerekli izin ve etik süreçler tamamlanmalıdır.

## VAD etiketleme

VAD sürekli skorlar olarak 0–1 aralığına normalize edilebilir:

- valence: olumlu ↔ olumsuz,
- arousal: sakin ↔ yoğun/uyarılmış,
- dominance: kontrolsüz/çekingen ↔ baskın/kendinden emin.

Tercihen aynı örnek birden fazla değerlendirici tarafından bağımsız etiketlenmeli ve değerlendiriciler arası uyum raporlanmalıdır.

## Big Five etiketleme

Kişilik etiketlerinin tahmini için metin sahibinden doğrulanmış bir kişilik ölçeği sonucu alınması, metin örnekleriyle eşleştirilmesi ve eğitim/test ayrımının kişi bazında yapılması önerilir.

Aynı kişinin metinleri eğitim ve test kümelerine karıştırılmamalıdır; aksi durumda kişiye özel bilgi sızıntısı oluşabilir.

## Veri bölümlerinde sızıntı kontrolü

Eğitim betiği `ml/train_regressor.py`, eğitimden önce `sample_id` ve `participant_id` alanlarını zorunlu tutar. Aynı katılımcının veya aynı örneğin train/validation/test bölümlerinden birden fazlasında bulunması durumunda eğitim durdurulur; böylece test metriğinin veri sızıntısıyla yapay biçimde yükselmesi önlenir. Boş kimlikler, yinelenen örnek kimlikleri ve 0–1 dışındaki/sayısal olmayan etiketler sessizce atlanmak yerine hata üretir.

Saf Python standart kütüphanesi kullanan kontroller `ml/tests/test_split_integrity.py` dosyasındadır ve GitHub Actions içinde otomatik çalışır.

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

Veri kontrolü:

```bash
python ml/data/validate_dataset.py ml/data/your_dataset.csv
```

Katılımcı bazlı bölme:

```bash
python ml/data/split_by_participant.py ml/data/your_dataset.csv ml/data/splits
```

VAD eğitimi:

```bash
python ml/train_regressor.py   --train ml/data/splits/train.csv   --validation ml/data/splits/validation.csv   --test ml/data/splits/test.csv   --labels valence arousal dominance   --model dbmdz/bert-base-turkish-cased   --output artifacts/vad
```

Big Five için aynı eğitim altyapısı:

```bash
python ml/train_regressor.py   --train ml/data/splits/train.csv   --validation ml/data/splits/validation.csv   --test ml/data/splits/test.csv   --labels openness conscientiousness extraversion agreeableness neuroticism   --model dbmdz/bert-base-turkish-cased   --output artifacts/big-five
```

Bu komutların ürettiği `metrics.json`, deney günlüğüne eklenmelidir. Sonuçlar çalıştırılmadan önceden doldurulmamalıdır.
