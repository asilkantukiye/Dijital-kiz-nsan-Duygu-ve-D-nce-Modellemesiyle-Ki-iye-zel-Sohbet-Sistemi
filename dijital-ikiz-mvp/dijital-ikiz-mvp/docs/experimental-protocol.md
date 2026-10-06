# Deneysel Geliştirme Protokolü

Bu belge, MVP'nin TÜBİTAK raporundaki Ar-Ge hedeflerine geçişinde kullanılacak ölçüm çerçevesini tanımlar.

## 1. Veri

Türkçe metinlerden oluşan veri kümesi; kaynak, lisans/izin durumu, örnek kimliği ve etiket bilgileriyle birlikte tutulmalıdır. Kişisel veri içeren gerçek kullanıcı konuşmaları, uygun izin ve veri koruma süreci olmadan eğitim verisi olarak kullanılmamalıdır.

## 2. Duygu modeli

Rapordaki VAD yaklaşımı için valence, arousal ve dominance boyutları ayrı hedefler olarak ele alınır.

Önerilen ölçümler:
- MAE / RMSE: sürekli skorlar için
- Pearson/Spearman korelasyonu: sıralı ilişki için
- Gerekirse üç boyutun ayrı ayrı sınıflandırılmış versiyonları için accuracy, precision, recall ve F1

%75 hedefi, deney tasarımı ve kullanılan metriğe göre açıkça tanımlanmalı; tek bir sayı olarak ölçüm tanımı olmadan kullanılmamalıdır.

## 3. Kişilik modeli

Big Five boyutları için etiketli veri ile regresyon veya sınıflandırma denenebilir.

Raporlanacak ölçümler:
- boyut bazlı hata / korelasyon,
- sınıflandırma kullanılıyorsa accuracy ve macro-F1,
- eğitim/doğrulama/test ayrımı.

## 4. Üslup modeli

Her kullanıcı için:
- cümle uzunluğu,
- emoji kullanımı,
- kısaltma,
- argo,
- resmiyet/gündeliklik,
- mizah göstergeleri

gibi özellikler çıkarılabilir.

Daha sonra klasik özellik vektörü ile embedding tabanlı yaklaşımın kişiselleştirme başarısı karşılaştırılmalıdır.

## 5. Kişiselleştirilmiş sohbet testi

Aynı kullanıcı profiline ait iki koşul karşılaştırılabilir:

A. Genel model yanıtı  
B. Dijital ikiz profili ile koşullandırılmış yanıt

Değerlendirme boyutları:
- üslup benzerliği,
- duygu uyumu,
- tutarlılık,
- yanıt kalitesi,
- güvenlik.

Değerlendiriciler mümkün olduğunca körleştirilmelidir.

## 6. Deney günlüğü

Her deney için:
- tarih,
- veri sürümü,
- model sürümü,
- hiperparametreler,
- eğitim süresi,
- metrikler,
- hata analizi,
- sonuç ve sonraki aksiyon

kaydedilmelidir.

## 7. Bilimsel raporlama kuralı

Ölçülmemiş performans değerleri sonuç olarak yazılmamalıdır. MVP'nin mevcut heuristic skorları bilimsel olarak doğrulanmış duygu veya kişilik ölçümleri değildir.
