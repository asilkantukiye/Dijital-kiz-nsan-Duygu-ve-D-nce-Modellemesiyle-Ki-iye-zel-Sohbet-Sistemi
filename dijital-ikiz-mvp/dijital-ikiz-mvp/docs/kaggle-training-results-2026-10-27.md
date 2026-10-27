# Kaggle Eğitim Sonuçları — 27 Ekim 2026

## Kanıt ve kapsam

- **Kaggle End-to-End Model Training çalıştırması:** [GitHub Actions run 40562948791](https://github.com/asilkantukiye/Dijital-kiz-nsan-Duygu-ve-D-nce-Modellemesiyle-Ki-iye-zel-Sohbet-Sistemi/actions/runs/40562948791)
- **Çalıştırma sonucu:** `success`
- **Artefakt doğrulaması:** `passed` — model paketinin bütünlük kontrolü ve beklenen `metrics.json` dosyaları doğrulanmış.
- **Eğitim kodu:** `ml/kaggle/dijital_ikiz_training.ipynb`; veri bölümleri sabit tohum kullanır. Polarite veri kaynağı revizyonu `ef87c7a2a7199a8b721c99425933316d35f9af2f); Qwen talimat veri kaynağı revizyonu `90f9589`.
- **Yayınlama durumu:** Qwen LoRA adaptörünün Hugging Face'e yüklenmesi, GitHub Actions `HF_WRITE_TOKEN` sırrı bulunmadığı için engellenmiş. Bu nedenle modelin Hugging Face'e yüklendiği veya web uygulamasında kullanıldığı iddia edilmemelidir.

## 1. Türkçe duygu polaritesi sınıflandırması

Görev etiketleri **negative / neutral / positive** biçimindedir. Bu sonuçlar yalnızca bu sınıflandırma görevi için geçerlidir; VAD, Big Five veya kişiye özel sohbet kalitesi değildir.

| Ölçüm | Sonuç |
|---|---:|
| Eğitim örneği | 15.000 |
| Doğrulama örneği | 3.000 |
| Bağımsız test örneği | 3.000 |
| Test accuracy | 0,9407 |
| Test macro-F1 | 0,9407 |
| Test weighted-F1 | 0,9407 |
| Çoğunluk sınıfı baseline accuracy | 0,3333 |
| Çoğunluk sınıfı baseline macro-F1 | 0,1667 |

Test kümesinde her sınıftan 1.000 örnek bulunmaktadır.

| Sınıf | Precision | Recall | F1 | Destek |
|---|---:|---:|---:|---:|
| Negative | 0,9303 | 0,8940 | 0,9118 | 1.000 |
| Neutral | 0,9980 | 0,9940 | 0,9960 | 1.000 |
| Positive | 0,8955 | 0,9340 | 0,9143 | 1.000 |

Karmaşıklık matrisi (gerçek sınıf satırları ve tahmin sütunları; sıralama negative, neutral, positive):

```text
                 Tahmin
Gerçek          Neg   Neu   Pos
Negative        894     1   105
Neutral           2   994     4
Positive         65     1   934
```

### Veri ve geçerlilik notları

- Kaynak: `winvoker/turkish-sentiment-analysis-dataset`, sabitlenmiş revizyon yukarıda verilmiştir.
- Kaynak sayfasında lisans beyanı CC BY-SA 4.0 olarak kaydedilmiştir. Birleşik veri kümesinin alt kaynakları ve yeniden dağıtım şartları ayrıca gözden geçirilmelidir; model skoru lisans uygunluğunu tek başına kanıtlamaz.
- Kod, test kümesindeki normalize edilmiş aynı metinleri eğitim bölümünden çıkarır. Bununla birlikte, bu ölçüm belirli bir gerçek kullanıcı grubuna veya zaman içinde görülecek dağılıma genelleme garantisi vermez.

## 2. Qwen3-4B QLoRA talimat ince ayarı

| Ölçüm | Sonuç |
|---|---:|
| Temel model | `Qwen/Qwen3-4B-Instruct-2507` |
| Veri kümesi | `TFLai/Turkish-Alpaca`, revizyon `90f9589` |
| Eğitim örneği (kodlanmış) | 1.498 |
| Doğrulama örneği (kodlanmış) | 150 |
| Test örneği (kodlanmış) | 250 |
| Temel model test loss | 2,3596 |
| İnce ayarlı model test loss | 1,4867 |
| Mutlak test loss değişimi (temel − ince ayarlı) | 0,8729 |

Test kaybındaki azalma, bu veri ve değerlendirme protokolündeki hedef yanıt tokenları üzerinde ölçülmüştür. **Tek başına** yanıtların doğruluğunu, kullanıcı tercihlerini, kişilik tahminini veya dijital ikiz niteliğini kanıtlamaz.

Bu deney genel Türkçe talimat verisi kullanmıştır. Kullanıcının özel sohbet geçmişiyle eğitilmiş, duygu/VAD/Big Five etiketleriyle doğrulanmış kişiye özel bir model değildir. Üretilen artefakt, tam birleştirilmiş model değil **LoRA adaptörüdür**; uyumlu temel model ve PEFT ile yüklenmesi gerekir.

Hub sayfasının Apache-2.0 olarak beyan ettiği veri lisansı ve modelin lisans/kullanım şartları, dağıtım veya yeniden dağıtım öncesinde ayrıca incelenmelidir.

## 3. Tamamlanmamış deneyler ve yayın kapıları

- **VAD:** Geçerli kaynak/izin bilgisi ve etiketli CSV sağlanmadığı için bu çalıştırmada eğitilmedi.
- **Big Five:** Doğrulanmış ölçek puanları ve uygun katılımcı/izin zinciri içeren CSV olmadığı için bu çalıştırmada eğitilmedi. Metinden yapay kişilik etiketleri türetilmedi.
- **Genel sohbet ↔ kişiselleştirilmiş sohbet değerlendirmesi:** Gerçek kullanıcı değerlendirmesi, kör insan puanlaması veya istatistiksel A/B sonucu bu eğitim raporunda yoktur.
- **Hugging Face:** Yükleme `HF_WRITE_TOKEN` eksik olduğu için yapılmadı; özel model depolarının varlığı ağırlıkların orada bulunduğu anlamına gelmez.
- **Vercel canlıya alma:** Bu model artefaktı web uygulamasına entegre edilmedi. Canlı dağıtım ayrıca güvenlik kapıları ve Vercel dağıtım kotası tarafından engellenmişti.

TÜBİTAK raporuna bu değerler yalnızca görev adı, veri kaynağı/revizyonu, split sayıları, metrik ve sınırlılıkları birlikte verilerek eklenmelidir. Polarite skorları VAD/Big Five başarısı veya projenin genel “%75 başarı” ölçütü olarak sunulmamalıdır.
