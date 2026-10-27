# Kaggle model eğitimi

Tek notebook: ml/kaggle/dijital_ikiz_training.ipynb.

## Otomatik eğitim ve artefakt akışı

Manuel yol: GitHub Actions → **Kaggle End-to-End Model Training** → **Run workflow** adımlarını main dalında çalıştır.

Bu sürüm ayrıca yalnızca ana dala gelen ve commit başlığında `[run-kaggle-training]` işaretini taşıyan özel bir tetiklemeyle tek gerçek eğitimi başlatabilir. Bu, sıradan commit'lerin GPU kotasını tüketmesini önlemek içindir. İş akışı Kaggle metadata'sını oluşturur, GPU ve Internet seçeneğini etkinleştirir, notebook'u Kaggle'a göndererek çalıştırır, bitiş durumunu bekler, model paketini indirir ve gerçek `metrics.json` dosyalarını doğrular. İşaretlenmiş commit, özel `hasankb00/dijital-ikiz-qwen3-4b-lora-pilot` deposuna doğrulanmış Qwen LoRA artefaktlarını yayımlamayı da dener. Bunun için `HF_WRITE_TOKEN` GitHub Actions secret'ı yazma yetkisine sahip olmalıdır; yoksa eğitim artefaktı yüklenebilir, ancak Hugging Face yayımlama adımı güvenli biçimde başarısız olur.

Workflow girdileri:

- **Kaggle notebook ID:** Varsayılan `asilkantkiye/dijital-ikiz-training`; hesabındaki gerçek notebook ID farklıysa `owner/slug` biçiminde düzelt.
- **Publish Qwen LoRA adapter:** Varsayılan kapalıdır. Yalnızca model artefaktları ve lisanslar incelendikten sonra aç.
- **Hugging Face repo ID:** Yayımlama seçildiyse `owner/model-name` biçiminde gir. Yeni depo özel (private) oluşturulur.

### Gerekli GitHub Actions Secrets

- Mevcut kurulumla geriye dönük uyum için `KAGGLE_KULLANABILEGIN_TOKEN`; ayrıca `KAGGLE_KULLANABILECEGIN_TOKEN` veya `KAGGLE_API_TOKEN` da desteklenir. Eski kimlik doğrulaması için `KAGGLE_USERNAME` ve `KAGGLE_KEY` de desteklenir. Secret adları GitHub kuralları nedeniyle ASCII harf/rakam/alt çizgi kullanmalıdır. Token değerini loglama ya da kaynak koda yazma.
- Hugging Face'e otomatik yükleme isteniyorsa, hedef model deposuna yazma yetkisiyle sınırlandırılmış `HF_WRITE_TOKEN` secret'ı gerekir. Bu, web uygulamasının inference token'ından ayrı tutulmalıdır.

Başarılı çalıştırmada `kaggle-digital-twin-model-artifacts` adlı GitHub Actions artefaktı, Kaggle'dan alınmış ZIP paketini ve `metrics-summary.json` dosyasını içerir. Eğitim veya veri doğrulaması başarısız olursa artefakt/model yayımlama adımları devam etmez.

### Hugging Face yayımlama sınırı

Bu adım Qwen3-4B için LoRA adaptörünü, tokenizer dosyalarını ve gerçek eğitim metriklerini yükler; **tam birleşik model üretmez ve canlı inference servisi başlatmaz**. Web uygulamasının özel adaptörü kullanabilmesi için daha sonra uyumlu model sunumu kurulmalı ve doğrulanmalıdır. Hugging Face Hub'a dosya yüklemek tek başına ücretsiz/sürekli çalışan model API'si sağlamaz.

Eski manuel Kaggle yolu gerekirse yedek olarak kullanılabilir. Bu otomatik akış Kaggle API token'ının ilgili notebook üzerinde çalıştırma yetkisine ve Kaggle hesabında uygun GPU kotasına bağlıdır.

## Eğitilen görevler

- **Türkçe polarite:** otomatik olarak sabit sürümlü `winvoker/turkish-sentiment-analysis-dataset` üzerinden. BERTurk, train/validation/test, accuracy, macro-F1, weighted-F1, sınıf bazlı F1 ve çoğunluk sınıfı baseline'ı raporlar. Kaynağın Hub lisansı CC BY-SA 4.0 olarak beyan edilmiştir; alt kaynak şartları ayrıca incelenmelidir.
- **VAD:** `sample_id, participant_id, text, source, license_or_consent, valence, arousal, dominance` kolonları olan uygun CSV eklenirse çalışır.
- **Big Five:** aynı ortak kolonlara ek olarak beş ölçek puanını içeren uygun CSV eklenirse çalışır. Kişilik skorları metinden tahmin edilerek etiket yapılmamalı; doğrulanmış ölçek ve gerekli onam kullanılmalıdır.

VAD/BF CSV'leri eklenmezse bu görevler atlanır; polarite pilotu yine çalışır. Aynı katılımcı ve normalize edilmiş yinelenen metinler farklı split'lere dağıtılmaz. Eksik/yer tutucu kaynak ve lisans alanları reddedilir.

Notebook'un statik CI kontrolü gerçek eğitimi çalıştırmaz. Yeni GitHub Actions akışı Kaggle eğitimini başlatır; metrikler yalnızca Kaggle çalışması başarıyla bitip artefaktlar doğrulandıktan sonra üretilmiş kabul edilir. İş akışını çalıştırmak için main dalında Actions → Kaggle End-to-End Model Training → Run workflow yolunu kullan. Polarite doğruluğu VAD veya Big Five doğruluğu değildir; proje raporuna yalnızca gerçek sonuçları ekle.
