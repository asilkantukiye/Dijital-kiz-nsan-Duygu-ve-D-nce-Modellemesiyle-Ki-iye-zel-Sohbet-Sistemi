# Eğitim koşusu tekrarlanabilirlik manifesti

`ml/train_regressor.py` ve `ml/kaggle/dijital_ikiz_training.ipynb`, eğitim tamamlandığında `metrics.json` içine veri ve çalışma ortamı manifesti ekler. Amaç, sonraki bir çalıştırmanın aynı dosyaları ve benzer yazılım/model koşullarını kullanıp kullanmadığını kontrol edebilmektir.

## Kaydedilen bilgiler

- Komut satırı eğiticisinde train/validation/test CSV dosyalarının tam baytlarına ait SHA-256 özeti ve yalnızca dosya adı.\n- Kaggle defterinde kaynak CSV'nin tam bayt hash'i ile train/validation/test bölümlerinin sabit satır sonu ve sütun sırasıyla serileştirilmiş içerik hash'leri.
- Her split'teki satır, benzersiz örnek ve benzersiz katılımcı sayıları ile hedef kolonları.
- Kaynak ve lisans/rıza alanlarındaki farklı değerlerin sayısı. Değerlerin kendisi, örnek metinleri ve katılımcı kimlikleri rapora kopyalanmaz.
- Python, NumPy, pandas, PyTorch ve Transformers sürümleri.
- Kullanılan Hugging Face model kimliği ve isteğe bağlı model revision bilgisi.
- Deney hiperparametreleri ve metrikler (mevcut rapor alanları).

SHA-256, CSV'nin tam içeriği değiştiğinde değişir; satır sırası veya satır sonu değişikliği de bu özeti değiştirir. Bu yüzden her koşuda kullanılan üç split dosyasını kontrollü bir konumda sakla ve rapordaki özetle eşleştir.

## Model sürümünü sabitleme

Aynı model adının ileride farklı ağırlıklara işaret etmesi riskini azaltmak için Hugging Face model deposundan değişmez commit SHA'sını doğrula. Komut satırı eğiticisinde `--model-revision`, Kaggle defterinde `MODEL_REVISION` değişkeniyle ver. Kaggle için doğrulanmış SHA belirtilmezse rapor bunu açıkça `model_revision_pinned: false` olarak kaydeder. Komut satırı örneği:

```bash
python ml/train_regressor.py \
  --train ml/data/splits/train.csv \
  --validation ml/data/splits/validation.csv \
  --test ml/data/splits/test.csv \
  --labels valence arousal dominance \
  --model dbmdz/bert-base-turkish-cased \
  --model-revision PASTE_VERIFIED_MODEL_COMMIT_SHA \
  --output artifacts/vad
```

Commit SHA yerine dal adı veya hareket edebilen etiket kullanmak aynı ağırlıkların gelecekte de geleceğini garanti etmez. Revision verilmezse rapor bu alanı `null` tutar; bu, model sürümünün sabitlenmediğini gösterir.

## Gizlilik ve sınırlar

Manifest ham metinleri veya ham katılımcı kimliklerini dışa vermez; yine de dosya özeti tek başına anonimleştirme değildir ve bilinen bir dosyayla karşılaştırma yapılabilir. Çıktıları araştırma dosyalarına uygun erişim kontrolleri altında sakla. Gerçek CSV'leri, koşul anahtarlarını veya özel veri kümelerini GitHub'a yükleme.

Bu mekanizma kaynak/lisans bilgilerinin hukuken geçerli olduğunu, verinin doğru etiketlendiğini veya modelin başarılı olduğunu kanıtlamaz. `source` ve `license_or_consent` alanlarının doğrulanması, veri kaynağı şartlarının ayrıca incelenmesi ve etik/onam süreçlerinin tamamlanması gerekir. Depoda bulunan boş şablonlar eğitim verisi değildir; gerçek eğitim ve metrikler üretilmeden başarı iddiasında bulunma.


Kaggle defterindeki rapor ayrıca Python, NumPy, pandas, PyTorch ve Transformers sürümlerini; eğitim kümesinin hedef ortalamasını kullanan basit referans baseline'ı ve modele göre MAE farkını içerir. Notebook split hash'leri kaydedilen DataFrame'lerin kanonik CSV serileştirmesine aittir; bu hash, dosya biçimi/sütun sırası/bağlı kütüphane sürümlerinden etkilenebilir. Manifest metinleri, katılımcı kimliklerini veya kaynak/lisans alanlarının ham değerlerini rapora kopyalamaz.
