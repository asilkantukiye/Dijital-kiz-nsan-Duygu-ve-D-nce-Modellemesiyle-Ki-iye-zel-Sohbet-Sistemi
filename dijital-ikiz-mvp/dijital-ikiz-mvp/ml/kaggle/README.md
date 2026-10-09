# Kaggle Eğitim — adım adım

Bu notebook gerçek eğitim için hazırlanmış kod taslağıdır. **Henüz eğitimin çalıştığını veya belirli bir başarı oranı elde edildiğini göstermez.** Model ancak etiketli araştırma verisiyle Kaggle üzerinde çalıştırılıp `metrics.json` üretildiğinde deney sonucu alınmış olur.

Notebook dosyası: `ml/kaggle/dijital_ikiz_training.ipynb`

## 1. Notebook'u Kaggle'a aç

1. GitHub deposunda `dijital-ikiz-mvp/dijital-ikiz-mvp/ml/kaggle/dijital_ikiz_training.ipynb` dosyasını aç.
2. Notebook içeriğini Kaggle'a aktar. Kaggle arayüzünde GitHub bağlantısı bulunuyorsa **File → Link to GitHub** bölümünden depoya erişim izni ver; alternatif olarak GitHub'dan notebook dosyasını indirip Kaggle'daki notebook içe aktarma akışını kullan.
3. Kaydedilen notebook'u kendi Kaggle hesabında aç. GitHub bağlantısı kurulmuş olsa bile notebook'un çalıştırılmasını ayrıca başlatmak gerekir.

## 2. Donanım ve internet

1. Notebook sağ panelinden `Settings` bölümüne gir.
2. `Accelerator` seçeneğinde erişimin varsa GPU seç.
3. Model ağırlıklarının indirilmesi için `Internet` erişimini aç.
4. Hesap doğrulama nedeniyle GPU seçeneği kapalıysa bu kısıtı atlatmaya çalışma; Kaggle'ın resmî hesap/telefon doğrulama akışını veya desteğini kullan.

## 3. Veriyi ekle

Sağ panelden **Add Data** ile lisansı/kullanım izni kontrol edilmiş araştırma verilerini ekle. Defter aşağıdaki şemayı ister:

- Her örnek için benzersiz `sample_id`
- Tekrarlanan örnekleri aynı kişiye bağlamak için `participant_id`
- Metin: `text`
- Veri kaynağı: `source`
- Lisans veya rıza açıklaması: `license_or_consent`
- VAD veri kümesi için: `valence`, `arousal`, `dominance`
- Big Five veri kümesi için: `openness`, `conscientiousness`, `extraversion`, `agreeableness`, `neuroticism`

Hedef skorlar 0–1 aralığında sayısal etiketler olmalıdır. `source` ve `license_or_consent` alanlarını doldurmak tek başına hukuki izni kanıtlamaz; veri kaynağının şartlarını araştırmacı ayrıca doğrulamalıdır. Kişisel konuşmaları uygun izin olmadan kullanma.

## 4. Hücreleri sırayla çalıştır

1. `Run All` yerine ilk aşamada üstten aşağı tek tek çalıştır.
2. İlk kontrol hücresi `/kaggle/input` altındaki CSV dosyalarını ve kolonları listeler.
3. Her hedef için yalnızca bir uygun CSV varsa defter onu seçer. Birden fazla dosya varsa hata mesajındaki dosya yollarına bakarak `VAD_DATASET_PATH` ve/veya `BIG5_DATASET_PATH` değişkenlerine doğru tam yolu yaz.
4. Veri kontrolü ve katılımcı bazlı bölme başarılı olmadan eğitim hücrelerine geçme.
5. Yalnızca uygun veri bulunan görevin eğitim hücresi çalışır; veri olmayan görev açıkça atlanır. Hata çıkarsa hata mesajını aynen paylaş; sırları, kişisel verileri veya özel token'ları paylaşma.

## 5. Beklenen çıktılar

Başarılı gerçek çalıştırmadan sonra Kaggle `/kaggle/working/` altında yalnızca gerçekten eğitilmiş görevlerin çıktıları bulunur. Örneğin VAD verisi varsa VAD çıktıları oluşur; Big Five verisi yoksa Big Five modeli/ metriği üretilmez:

- `artifacts/vad/best_model.pt`
- `artifacts/vad/metrics.json`
- `artifacts/big-five/best_model.pt`
- `artifacts/big-five/metrics.json`
- `dijital-ikiz-model-artifacts.zip`

Notebook sonunda ZIP paketini Kaggle'dan indir. Model ağırlıklarını ve sonuç metriklerini kontrol etmeden TÜBİTAK raporuna başarı yüzdesi yazma.

## 6. Şu anki doğrulama sınırı

GitHub Actions notebook'un JSON ve Python sözdizimini statik olarak kontrol eder. Bu kontrol Kaggle GPU eğitimini çalıştırmaz, veri etiketlerinin bilimsel kalitesini doğrulamaz ve model performansı iddiası oluşturmaz. Gerçek deney için Kaggle'da hücrelerin çalıştırılması ve üretilen test metriklerinin kaydedilmesi gerekir.
