# TÜBİTAK 2204 — Dijital İkiz İnsan bilimsel doğrulama şablonu

Bu şablon, Kaggle çalıştırmasının ürettiği `training-metrics.json` dosyası ve her görevin `metrics.json` çıktılarıyla doldurulmalıdır. Gerçek bir çalışma tamamlanmadan sayısal sonuç, başarı yüzdesi veya “doğrulandı” ifadesi eklenmez. Notebook ayrıca çalıştırma bazlı `scientific-validation-report.md` dosyasını üretir.

## 1. Araştırma sorusu ve özgün katkı

**Araştırma sorusu:** Türkçe sohbet metninden çıkarılan sinyaller, (a) üç sınıflı duygu polaritesi, (b) valence-arousal-dominance (VAD) boyutları ve (c) Beş Faktör kişilik ölçeği skorları gibi birbirinden ayrı hedefleri ne ölçüde öngörebilir; Qwen3-4B LoRA uyarlaması genel Türkçe talimat verisinde bağımsız test kaybını düşürür mü?

**Özgün katkı iddiası**, yalnızca gerçekten uygulanan yöntemle sınırlandırılmalıdır: veri sızıntısı kontrolleri, sabit seed ve veri sürümleri, karşılaştırmalı baseline, görev bazlı metrikler, SHA-256 dosya özeti, otomatik değerlendirme ve özel Hugging Face yayını. Bu mühendislik özellikleri tek başına bilimsel üstünlüğü veya TÜBİTAK finalistliği garanti etmez.

## 2. Otomatik deney kaydı

Kaynak olarak doğrudan `training-metrics.json` kullanın:

- Kaynak commit / GitHub run ID / Kaggle kernel ID
- Python, PyTorch, Transformers sürümleri ve GPU modeli
- Rastgele seed, model kimliği ve veri kümesi revision SHA'ları
- Train / validation / test örnek sayıları
- Kaynak verinin SHA-256 hash'leri, etiket şeması ve veri lisansı/izin açıklaması
- `training-manifest.json` içinde her çıktının boyutu ve SHA-256 özeti

Bir kaynak veya modelin revision SHA'sı kaydedilmemişse bu alan “bilinmiyor” olarak kalmalı; tekrar üretilebilirlik tam olarak sağlandı diye sunulmamalıdır.

## 3. Görevler ve doğru metrik seçimi

| Görev | Temel test metrikleri | Baseline ve yorum |
|---|---|---|
| Duygu polaritesi | Accuracy, macro-F1, weighted-F1, sınıf bazlı precision/recall/F1 ve confusion matrix | Çoğunluk sınıfı baseline ile karşılaştır. Sınıf dengesizliğinde macro-F1'i özellikle bildir. |
| VAD regresyonu | Hedef başına ve ortalama MAE, RMSE, R² | Eğitim kümesi hedef ortalaması baseline'ını karşılaştır. Negatif R² mümkündür; daha düşük MAE/RMSE daha iyidir. |
| Big Five regresyonu | Beş özelliğin her biri için MAE, RMSE, R² | Eğitim ortalaması baseline'ı ile karşılaştır; her boyutun ayrı performansını ver. |
| Qwen3-4B QLoRA | Validation loss, base-model test loss, fine-tuned test loss, fark | Aynı bağımsız test örnekleri ve aynı maskelenmiş hedef yanıt tokenları kullanılmalı. Loss düşüşü tek başına konuşma kalitesi veya kişilik benzerliği kanıtı değildir. |

Metrikler yalnızca gerçek test çıkarımından sonra oluşturulur. Bir görev için doğrulanmış veri yoksa durum `not_evaluated_missing_validated_dataset` olur; boş veya varsayımsal metrik üretilmez.

## 4. Veri bölme ve sızıntı denetimi

VAD/Big Five tabloları şu kolonları taşımalıdır:

- Ortak alanlar: `sample_id`, `participant_id`, `text`, `source`, `license_or_consent`
- VAD hedefleri: `valence`, `arousal`, `dominance`
- Big Five hedefleri: `openness`, `conscientiousness`, `extraversion`, `agreeableness`, `neuroticism`

Regresyon hedefleri veri sözleşmesindeki 0–1 aralığına uyumlu olmalı ve dönüşüm yöntemi belgelenmelidir. Aynı katılımcı veya Unicode NFKC/casefold/boşluk normalizasyonundan sonra aynı metin train, validation ve test bölümlerine dağılmamalıdır. Sızıntı testi başarısız olursa sonuç raporlanmamalı; bölme durdurulmalıdır.

Duygu polaritesi pilot veri kümesinde katılımcı kimliği olmayabilir. Bu nedenle örnek düzeyindeki test, kişi düzeyinde genellemeyi kanıtlamaz. Kaynağa özgü kelime/genre kestirmelerini sınamak için ayrıca source-held-out ve bağımsız doğal sohbet testi yapılmalıdır.

## 5. VAD etiketlerinin geçerliliği

VAD, polarite sınıflandırmasıyla aynı görev değildir. Her hedefin hangi yönerge, ölçek ve anotasyon protokolüyle elde edildiği açıklanmalıdır. İnsan değerlendirmesi varsa birden çok anotatör, değerlendiriciler arası uyum (hedefe ve tasarıma uygun ICC/Krippendorff alpha vb.) ve uyuşmazlık çözüm yöntemi raporlanmalıdır. Etiketlerin yalnızca 0–1 aralığında olması geçerlilik kanıtı değildir.

VAD sonucu, VAD etiketli bağımsız test kümesi ve uygun baseline olmadan “başarılı” olarak nitelendirilmemelidir.

## 6. Big Five etiketlerinin geçerliliği ve etik

Big Five skorları tercihen doğrulanmış Türkçe psikometrik ölçek ve açık bir skorlamayla elde edilmelidir. Örneklem, ölçek uyarlaması, iç tutarlılık (ör. uygun alfa/omega), ölçüm güvenirliği ve test-tekrar test / dış örneklem geçerliliği belgelenmelidir. Bu notebook'un regresyon metrikleri bu psikometrik kontrollerin yerine geçmez.

Çıktılar tanı, klinik değerlendirme, kesin karakter hükmü veya işe alım/eleme kararı olarak sunulmamalıdır. Katılımcı onayı, veri minimizasyonu, anonimleştirme ve geri çekme/silme prosedürü açıklanmalıdır.

## 7. Qwen LoRA değerlendirme sınırı

Qwen deneyi, `Qwen/Qwen3-4B-Instruct-2507` temel modelini genel Türkçe talimat veri kümesiyle QLoRA üzerinden uyarlar. Bu veri kullanıcıya özgü bir dijital ikiz veya VAD/Big Five etiketli veri değildir. Base ve fine-tuned loss aynı ayrılmış test kümesinde hesaplanır; yayın kalite kapısı fine-tuned loss'un base loss'tan düşük olmasını gerektirir.

Ek doğrulama için önceden tanımlanmış test yönergeleri, kör insan değerlendirmesi, güvenlik ve halüsinasyon incelemesi, tekrarlı seed'ler ve mümkünse bağımsız test kümesi gereklidir. Loss düşüşü “model insanın düşünce ve duygularını taklit ediyor” iddiasını tek başına desteklemez.

## 8. Yayın ve bütünlük

Hugging Face'e yalnızca aşağıdaki şartlarda yayın yapılmalıdır:

1. Adaptör config'i beklenen Qwen temel modelini göstermeli.
2. Adaptör ağırlığı ve tokenizer dosyaları boş olmamalı.
3. Train/validation/test sayıları ve finite loss metrikleri geçerli olmalı.
4. Fine-tuned test loss temel model test loss'undan düşük olmalı.
5. Depo private olarak oluşturulmalı/kontrol edilmeli; yayınlanan dosya boyutları ve SHA-256 özeti doğrulanmalı.
6. Token, gizli anahtar, katılımcı tanımlayıcısı veya ham hassas veri rapora/yayına dahil edilmemeli.

## 9. Sonuç cümlesi için şablon

> Bu çalıştırmada [görev adı] için [test örnek sayısı] bağımsız test örneğinde [metrikler] elde edilmiştir. [Baseline adı] ile karşılaştırıldığında [fark] görülmüştür. Sonuçlar yalnızca belirtilen veri ve model sürümleri için geçerlidir. [VAD/Big Five/harici değerlendirme/psikometrik doğrulama] bu çalıştırmada yapılmadıysa açıkça belirtilmiştir. Bu bulgular tek başına kişi-özel dijital ikiz, klinik/psikometrik geçerlilik veya genel Türkçe sohbet performansı kanıtı sayılmaz.

**Raporu yayımlamadan önce:** eğitim gerçekten tamamlanmış olmalı; `training-metrics.json` ve `scientific-validation-report.md` aynı run'a ait olmalı; kullanılan veri şartları ve model lisansları ayrıca incelenmelidir.
