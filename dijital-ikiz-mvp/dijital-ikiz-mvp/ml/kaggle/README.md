# Kaggle model eğitimi

Tek notebook: ml/kaggle/dijital_ikiz_training.ipynb.

## Otomatik eğitim ve artefakt akışı

Manuel yol: GitHub Actions → **Kaggle End-to-End Model Training** → **Run workflow** adımlarını main dalında çalıştır.

Bu sürüm, ana dala gelen ve commit başlığında `[run-kaggle-training]` işaretini taşıyan commit'lerle otomatik eğitim başlatabilir; böylece sıradan commit'ler GPU kotasını tüketmez. Ayrıca GitHub Actions → **Kaggle End-to-End Model Training** → **Run workflow** yoluyla manuel başlatılabilir. İş akışı Kaggle metadata'sını oluşturur, GPU ve Internet seçeneklerini etkinleştirir, notebook'u Kaggle'a gönderip çalıştırır, bitiş durumunu bekler, paketini indirir ve gerçek metrik dosyalarını doğrular. Varsayılan Hugging Face hedefi `hasankb00/dijital-ikiz-qwen3-4b-lora` deposudur. Yayımlama için Kaggle Notebook Secrets'ta `HF_WRITE_TOKEN` bulunabilir; GitHub Actions Secrets'taki aynı isimli token ise bağımsız yayınlama ve SHA-256 doğrulama adımı için isteğe bağlıdır.

Workflow girdileri:

- **Kaggle notebook ID:** Varsayılan olarak doğrulanmış Kaggle hesabı adıyla `hesap-adı/dijital-ikiz-training` kullanılır. Mevcut notebook slug farklıysa gerçek `owner/slug` değerini gir.
- **Publish Qwen LoRA adapter:** Varsayılan açıktır; eğitim tamamlanıp kalite kapıları geçilirse özel Hugging Face deposuna yayınlanır.
- **Hugging Face repo ID:** Varsayılan `hasankb00/dijital-ikiz-qwen3-4b-lora`. Bu, GitHub proje deposundan farklı bir model deposudur.

### Gerekli GitHub Actions Secrets

- Mevcut kurulumla geriye dönük uyum için `KAGGLE_KULLANABILEGIN_TOKEN`; ayrıca `KAGGLE_KULLANABILECEGIN_TOKEN` veya `KAGGLE_API_TOKEN` da desteklenir. Eski kimlik doğrulaması için `KAGGLE_USERNAME` ve `KAGGLE_KEY` de desteklenir. Secret adları GitHub kuralları nedeniyle ASCII harf/rakam/alt çizgi kullanmalıdır. Token değerini loglama ya da kaynak koda yazma.
- `HF_WRITE_TOKEN` GitHub Actions Secret'ı, GitHub tarafında ek yayınlama ve SHA-256 doğrulama adımı için isteğe bağlıdır. Bu, web uygulamasının inference token'ından ayrı tutulmalıdır. Token Kaggle Notebook Secrets'ta varsa notebook'un kendisi doğrudan yayınlama yapabilir.

**Önemli:** GitHub Actions, Kaggle arayüzündeki Notebook Secrets alanını okuyamaz. Otomatik hattın Kaggle notebook'unu başlatması için Kaggle API tokenı yukarıdaki adlardan biriyle **GitHub Actions Secrets** içinde olmalıdır. Hugging Face yayımlaması iki yoldan çalışabilir: `HF_WRITE_TOKEN` Kaggle Notebook Secrets'ta varsa notebook model yayınını kendi içinde dener; aynı token GitHub Actions Secrets'ta da varsa GitHub tarafındaki doğrulanmış publisher ek bir yayınlama/doğrulama adımı çalıştırır. İki secret kasası birbirine otomatik bağlanmaz.

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
