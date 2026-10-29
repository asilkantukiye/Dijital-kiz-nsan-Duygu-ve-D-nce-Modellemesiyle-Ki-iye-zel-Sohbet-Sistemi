# Otonom Kaggle eğitimi ve özel Hugging Face yayını

## Otomatik akış

Bu depoda `.github/workflows/kaggle-end-to-end-training.yml` iş akışı, `[run-kaggle-training]` işaretli bir `main` commit'iyle ilk eğitimi tetikler. Yeniden çalıştırmak için GitHub Actions → **Trigger Kaggle End-to-End Model Training** → **Run workflow** seçeneği de vardır.

Akış `kaggle kernels push` ile kodu gönderip çalıştırır; `kaggle kernels status` ile son durumu izler; tamamlanınca `kaggle kernels output` ile çıktıları indirir. `--no-run` kullanmaz.

## Zorunlu GitHub Actions sırları

- Tercihen `KAGGLE_API_TOKEN`; uyumluluk için workflow ayrıca `KAGGLE_KULLANABILEGIN_TOKEN` / `KAGGLE_KULLANABILECEGIN_TOKEN` veya `KAGGLE_USERNAME` + `KAGGLE_KEY` adlarını kabul eder.
- `HF_WRITE_TOKEN`: hedef Hugging Face model deposuna yazma izni olan User Access Token. Token değeri hiçbir dosyaya yazılmaz.

Bu sırlardan biri eksikse credential ön kontrolü GPU işi gönderilmeden durur.

## Çıktılar ve kalite kapıları

Başarılı eğitim paketi `training-metrics.json`, `scientific-validation-report.md`, `training-manifest.json`, model ağırlıkları/adaptör dosyaları ve SHA-256 dosya özetini içerir. GitHub Actions, Qwen adaptörünü `hasankb00/dijital-ikiz-qwen3-4b-lora` deposuna yalnızca test loss temel modelden düşükse yayınlar; depo private olmalı ve yükleme sonrası dosyalar doğrulanmalıdır.

VAD ve Big Five yalnızca gerekli hedefleri, örnek/katılımcı kimliklerini ve kaynak/lisans/izin alanlarını sağlayan doğrulanmış CSV dosyaları varsa eğitilir. Uygun veri yoksa rapor bu görevleri “değerlendirilmedi” diye işaretler; polarite metrikleri VAD veya kişilik geçerliliği olarak sunulmaz.

## Güvenli yeniden çalıştırma

Hugging Face token'ı yalnızca GitHub Actions Secrets içinde tutun. Notebook'u Kaggle arayüzünden doğrudan çalıştırmak da istenirse aynı token ayrıca Kaggle Notebook Secrets içinde `HF_WRITE_TOKEN` adıyla tanımlanmalıdır; GitHub Secrets otomatik olarak Kaggle'a aktarılmaz.

## Reusable workflow trigger invariant

The wrapper may call the training workflow because a tagged commit was pushed to `main`. Inside the reusable workflow, do not require `github.event_name == 'workflow_call'`: GitHub exposes the caller's event to the called workflow. The training job should gate on `github.ref == 'refs/heads/main'`; the wrapper itself controls which push messages are allowed to spend GPU quota.

Credentials are held in separate stores: the Kaggle API credential must be a GitHub Actions Secret for the runner to submit the notebook, while `HF_WRITE_TOKEN` may be kept in Kaggle Notebook Secrets for notebook-side publication. An optional GitHub Actions `HF_WRITE_TOKEN` enables the separate validated publisher; its absence must not block Kaggle training.
