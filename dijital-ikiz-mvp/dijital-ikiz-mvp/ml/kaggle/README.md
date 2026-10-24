# Kaggle model eğitimi

Tek notebook: `ml/kaggle/dijital_ikiz_training.ipynb`.

## Akış

1. GitHub Actions → **Prepare Kaggle Model Training** → Run workflow.
2. [Kaggle notebook'unu aç](https://www.kaggle.com/code/asilkantkiye/dijital-ikiz-training).
3. Kaggle sağ panelinde **Settings → Internet = On**; erişimin varsa **Accelerator = GPU**.
4. **Run All** çalıştır. Bu defterin interneti API metadata'sından garanti edilemiyor; önceki günlükte `pypi.org` DNS hatası görüldüğü için internet ayarı arayüzden açılmalıdır.
5. Eğitim bitince GitHub Actions → **Download Kaggle Model Artifacts** → Run workflow.
6. `kaggle-model-artifacts` artifact'ini indir. ZIP tüm görev modelleri ve `metrics.json` raporlarını; `metrics-summary.json` metriklerin özetini içerir.

## Eğitilen görevler

- **Türkçe polarite:** otomatik olarak sabit sürümlü `winvoker/turkish-sentiment-analysis-dataset` üzerinden. BERTurk, train/validation/test, accuracy, macro-F1, weighted-F1, sınıf bazlı F1 ve çoğunluk sınıfı baseline'ı raporlar. Kaynağın Hub lisansı CC BY-SA 4.0 olarak beyan edilmiştir; alt kaynak şartları ayrıca incelenmelidir.
- **VAD:** `sample_id, participant_id, text, source, license_or_consent, valence, arousal, dominance` kolonları olan uygun CSV eklenirse çalışır.
- **Big Five:** aynı ortak kolonlara ek olarak beş ölçek puanını içeren uygun CSV eklenirse çalışır. Kişilik skorları metinden tahmin edilerek etiket yapılmamalı; doğrulanmış ölçek ve gerekli onam kullanılmalıdır.

VAD/BF CSV'leri eklenmezse bu görevler atlanır; polarite pilotu yine çalışır. Aynı katılımcı ve normalize edilmiş yinelenen metinler farklı split'lere dağıtılmaz. Eksik/yer tutucu kaynak ve lisans alanları reddedilir.

Bu defterin statik CI kontrolü gerçek eğitimi çalıştırmaz. Metrikler ancak Kaggle'da Run All başarıyla bittiğinde oluşur. Polarite doğruluğu VAD veya Big Five doğruluğu değildir; proje raporuna yalnızca gerçek sonuçları ekle.
