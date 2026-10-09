# TÜBİTAK Proje Haritası

## Rapor Basamakları → Yazılım Karşılığı

### 1. Veri Toplama, Ön İşleme ve Etiketleme
Kaggle notebook içinde VAD ve Big Five için ayrı çalıştırılabilen eğitim hattı, veri şeması kontrolleri ve katılımcı bazlı train/validation/test bölmesi bulunmaktadır. Ancak bu yazılım henüz gerçek, izin/lisansı doğrulanmış veri ile Kaggle üzerinde çalıştırılmış ve test metrikleri kaydedilmiş değildir. Bu nedenle deneysel sonuçlar beklemededir.

### 2. Duygu ve Kişilik Analizi
MVP'deki \`lib/twin.ts\` dosyası yalnızca baseline/heuristic göstergeler üretir. Gerçek model eğitimi ve ölçüm bu yapının sonraki sürümüdür.

### 3. Bireysel İfade Biçimi
MVP, temel üslup özelliklerini sayısal profile dönüştürür. Embedding tabanlı temsil henüz Ar-Ge çalışması olarak ayrılmıştır.

### 4. Kişiye Özel Sohbet Sistemi
\`app/api/chat/route.ts\` kullanıcı oturumunu doğrular, geçmişten bağlam alır, profili günceller ve LLM yanıtını üretir.

### 5. Test, Değerlendirme ve Uygulama
MVP temel işlev testleri için hazırdır. Bilimsel kullanıcı/A-B testleri ayrıca yürütülmelidir.

## Mevcut durumun doğru ifadesi

Bu repository, projenin ilk çalışan yazılım prototipidir. Rapordaki tüm Ar-Ge hedeflerinin deneysel olarak kanıtlandığı anlamına gelmez.
