# Üslup A/B deneyi: örneklem ve istatistiksel güç planı

## Mevcut 30-vakalı sentetik pilotun gerçek örneklem büyüklüğü

Pilot veri setinde 10 ayrı Türkçe istem üç sentetik üslup profiline uygulanır. Bu nedenle 30 profil-istem çifti, 30 bağımsız deney birimi değildir. Birincil istatistiksel çıkarım birimi, aynı istemin üç profilde tekrarlanmasını birlikte tutan **benzersiz istem kümesidir**; mevcut pilotta küme sayısı 10'dur. Her küme üç eşleştirilmiş vaka ve toplam altı model yanıtı üretir.

İki veya üç değerlendiricinin aynı yanıtları puanlaması değerlendirici uyumunu ve ölçüm hassasiyetini artırır; bağımsız istem kümesi sayısını artırmaz. Bu nedenle örneklem büyüklüğü raporda değerlendirici sayısıyla veya 30 vaka sayısıyla şişirilmemelidir.

## Önsel güç hesabı

Birincil sonuç, her istem kümesi için kişiselleştirilmiş koşul ile genel koşul arasındaki ortalama üslup uyumu puan farkıdır. Planlama için eşleştirilmiş farkların standart sapmasına bölünmüş ortalama fark, yani Cohen'in eşleştirilmiş etki büyüklüğü (d_z), kullanılır.

İki yönlü α=0,05 ve hedef güç 0,80 varsayımıyla eşleştirilmiş t-testi için merkezi olmayan t dağılımına dayalı yaklaşık planlama değerleri:

| Varsayılan etki büyüklüğü (d_z) | Gerekli bağımsız istem kümesi | %15 veri kaybı payıyla hedef | 3 profil varsa yaklaşık vaka sayısı |
|---:|---:|---:|---:|
| 0,30 | 90 | 106 | 318 |
| 0,40 | 52 | 62 | 186 |
| 0,50 | 34 | 40 | 120 |
| 0,60 | 24 | 29 | 87 |
| 0,80 | 15 | 18 | 54 |

Bu tablo **gerçek etki büyüklüğünü bildirmez**; planlama varsayımlarını gösterir. Nihai analiz protokolü 10 küme üzerinde bootstrap güven aralığı ve işaret-değiştirme permütasyon testi kullandığı için bu t-testi tablosu doğrudan son analiz sonucu yerine geçmez. Ön pilot verisi elde edildikten sonra bağımsız istem kümeleri üzerinden simülasyon tabanlı güç analizi yapılması tercih edilir. Etki büyüklüğü, güç hedefi veya örneklem sonradan gözlenen p-değerine göre değiştirilmemelidir.

**Pratik hedef:** Orta büyüklükte (d_z=0,50) varsayımıyla en az 34 analiz edilebilir benzersiz istem kümesi; eksik puan/yanıt olasılığı için yaklaşık 40 küme planlanabilir. Üç hedef profil kullanılırsa bu, yaklaşık 120 profil-istem vakasıdır. Bütçe, zaman ve değerlendirme kapasitesi elvermezse mevcut 10 kümeli pilot açıkça keşifsel olarak raporlanmalı; doğrulayıcı kanıt gibi sunulmamalıdır.

## Çalıştırılabilir hesaplama

SciPy'nin kurulu olduğu Python ortamında aşağıdaki kod, eşleştirilmiş t-testi varsayımı altında hedef örneklem sayısını yeniden hesaplar:

```python
import math
from scipy.stats import nct, t

def paired_power(n, dz, alpha=0.05):
    df = n - 1
    critical = t.ppf(1 - alpha / 2, df)
    noncentrality = dz * math.sqrt(n)
    return nct.sf(critical, df, noncentrality) + nct.cdf(-critical, df, noncentrality)

for dz in (0.30, 0.40, 0.50, 0.60, 0.80):
    n = 2
    while paired_power(n, dz) < 0.80:
        n += 1
    print(dz, n, math.ceil(n / 0.85))
```

Bu planlama kodu yalnızca örneklem hesabına yarar. 1-5 Likert puanları, kümelenme ve olası değerlendirici etkileri nedeniyle son deneyde varsayımlar ayrıca incelenmeli; birincil permütasyon/bootstrap planı veri görülmeden sabitlenmelidir.
