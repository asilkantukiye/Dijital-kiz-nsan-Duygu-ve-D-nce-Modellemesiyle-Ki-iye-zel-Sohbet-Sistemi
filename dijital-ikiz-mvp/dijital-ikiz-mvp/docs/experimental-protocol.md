# Üslup Kişiselleştirme Karşılaştırma Protokolü

## 1. Araştırma sorusu

Türkçe bir sohbet sisteminde kullanıcının ifade biçimine göre kişiselleştirilen yanıtlar, aynı temel modelin genel yanıtlarına kıyasla üslup uyumu ve tutarlılık açısından daha iyi sonuç veriyor mu?

## 2. Hipotez

Üslup profiliyle koşullandırılan yanıtların kör değerlendiricilerce verilen üslup uyumu puanları, aynı temel modelin profil verilmeyen genel yanıtlarından daha yüksek olacaktır. Hipotez desteklenmezse bu sonuç değiştirilmeden raporlanır.

## 3. Deney deseni

Her test girdisi için iki yanıt üretilir:

- **A – Genel koşul:** temel model aynı güvenlik ve görev talimatlarıyla yanıt verir; üslup profili sistem mesajına eklenmez.
- **B – Kişiselleştirilmiş koşul:** aynı model, aynı kullanıcı mesajı ve aynı konuşma bağlamıyla yanıt verir; yalnızca deneysel üslup profili sistem mesajına eklenir.

Model sürümü, LoRA alias'ı, kullanıcı mesajı, konuşma bağlamı, temperature, top_p ve token sınırı iki koşulda aynı olmalıdır. LoRA adaptörü kullanılacaksa iki koşulda da aynı adaptör etkin olmalıdır. Böylece deney LoRA'nın genel Türkçe talimat performansını değil, profil koşullandırmasının katkısını sınar.

## 4. Veri ve üslup profili

İlk teknik pilotta araştırmacı tarafından hazırlanmış sentetik Türkçe kullanıcı mesajları ve önceden yazılmış üslup örnekleri kullanılabilir. Bu sonuçlar gerçek kullanıcı davranışına genellenemez. Gerçek katılımcı verisi kullanılacaksa veri toplamadan önce gerekli etik/kurumsal izinler, aydınlatma ve gönüllü onam süreçleri tamamlanmalıdır. Reşit olmayan katılımcılarla çalışma yapılmamalıdır; ayrıca gerekli izin ve veli onamı olmadan kişisel sohbet verisi toplanmamalıdır.

Üslup profili yalnızca metinden gözlenebilen dil özelliklerini ifade eder: resmiyet/gündeliklik, cümle uzunluğu, emoji, kısaltma/argo ve mizah göstergeleri. Profil psikolojik kişilik, klinik durum veya duygusal teşhis değildir.

## 5. Birincil ve ikincil ölçütler

**Birincil ölçüt:** Üslup uyumu (1–5 puan).

İkincil ölçütler:
- Konuşma tutarlılığı (1–5)
- Yanıtın soruya uygunluğu (1–5)
- Doğallık ve okunabilirlik (1–5)
- Güvenlik: ihlal var/yok ve hata türü

Puanlama: 1 = çok düşük, 5 = çok yüksek. Ölçütlerin tanımları değerlendiricilere verilecek aynı puanlama yönergesinde yer almalıdır. Bunlar sınıflandırma doğruluğu değildir; sonuçlar “% doğruluk” şeklinde adlandırılmamalıdır.

## 6. Kör değerlendirme ve analiz

Yanıtlar rastgele A/B kodlarıyla, koşul bilgisi gizlenerek değerlendirilir. Mümkünse her yanıt en az iki değerlendirici tarafından aynı yönergeyle puanlanır. Koşul anahtarı puanlama tamamlanana kadar ayrı saklanır.

Her test girdisinin A ve B puanları eşleştirilir. Ortalama fark, standart sapma ve %95 güven aralığı raporlanır. Örneklem ve dağılım uygunsa eşleştirilmiş t-testi; uygun değilse Wilcoxon işaretli sıralar testi kullanılır. Değerlendiriciler arası uyum ayrıca incelenir. Veri sayısı, eksik puanlar, dışlanan örnekler ve tüm analiz kararları raporlanır.

## 7. Tekrar üretilebilirlik

Her çalışmada şu bilgiler kaydedilir: deney tarihi, Git commit'i, model ve adaptör kimliği, endpoint sürümü, veri dosyası hash'i, üretim parametreleri, test girdileri, kör yanıt paketi, ayrı koşul anahtarı, ham puanlar ve analiz betiği.

Depodaki `scripts/run-style-ab-evaluation.mjs` sentetik pilot veri üzerinde iki koşulu üretir. `ml/private/` altındaki çıktı ve koşul anahtarı Git'e eklenmemelidir.

## 8. Sonuçları yorumlama sınırı

LoRA test loss değerinin düşmesi kişiselleştirme başarısını kanıtlamaz. Sentetik pilot sonuçları gerçek kullanıcılara genellenemez. Mevcut `lib/twin.ts` profili el ile belirlenmiş sezgisel kurallardan oluşur; doğrulanmış psikometrik ölçüm değildir. VAD, Big Five, psikolojik fayda veya akran zorbalığını önleme iddiaları bu deneyin kapsamı dışındadır.

Ölçülmemiş performans değerleri sonuç olarak yazılmamalıdır.
