# Kaggle Eğitim

## 1. GitHub bağlantısı

Kaggle'da New Notebook oluştur ve Notebook Editor içindeki File > Link to GitHub akışından bu repository'yi bağla. Notebook dosyası repo içinde `dijital-ikiz-mvp/dijital-ikiz-mvp/ml/kaggle/dijital_ikiz_training.ipynb` konumundadır.

## 2. Donanım

Notebook ayarlarında Accelerator bölümünden GPU seç. Model ağırlıklarının Hugging Face üzerinden indirilebilmesi için Kaggle'da Internet erişimi de gerekebilir.

## 3. Veri

Sağ panelden Add Data ile gerçek araştırma veri setini ekle. Veri setinde en az `participant_id`, `text` ve eğitim yapılacak hedef kolonlar bulunmalıdır.

VAD: `valence`, `arousal`, `dominance`

Big Five: `openness`, `conscientiousness`, `extraversion`, `agreeableness`, `neuroticism`

Gerçek kullanıcı verisi için kaynak/lisans veya açık rıza bilgisi ve kimlik ayrıştırması araştırma sürecinin parçasıdır.

## 4. Eğitim

Notebook önce veri doğrulamasını ve katılımcı bazlı train/validation/test bölmesini yapar; sonra Türkçe BERT tabanlı regresyon modellerini eğitir.

Çıktılar:

- `artifacts/vad/best_model.pt`
- `artifacts/vad/metrics.json`
- `artifacts/big-five/best_model.pt`
- `artifacts/big-five/metrics.json`

## 5. TÜBİTAK raporu

Gerçek test çalıştırması tamamlanmadan hiçbir başarı yüzdesi yazılmamalıdır. MAE/RMSE/R² ve veri bölme bilgileri deney günlüğüne aktarılmalıdır.