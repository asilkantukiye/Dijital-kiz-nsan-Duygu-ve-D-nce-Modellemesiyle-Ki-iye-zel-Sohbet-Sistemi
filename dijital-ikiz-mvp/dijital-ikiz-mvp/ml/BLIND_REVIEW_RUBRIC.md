# Kör insan değerlendirmesi — uygulama yönergesi

Bu protokol, aynı isteme verilen iki yanıtı hangi koşuldan geldiklerini bilmeyen değerlendiricilere sunarak insan değerlendirmesi hazırlamaya yarar. Kod, etiketleri gizlemeye yardımcı olur; katılımcı/araştırma izinlerinin yerine geçmez.

## Veri hazırlama

1. Her vaka için iki yanıt üret: aynı `prompt_text` girdisine ait `personalized` ve `baseline`.
2. Kaynak CSV şu sütunları içermeli: `pair_id,prompt_text,response_text,variant`. `pair_id` rastgele takma vaka anahtarı olmalı; e-posta, ham Supabase `user_id`, isim veya başka kimlik bilgisi kullanma.
3. Hazırlama komutu:

```bash
python ml/prepare_blind_review.py ml/data/blind_review_input.csv \
  --review-output ml/results/blind_review.csv \
  --key-output ml/private/condition_key.csv \
  --seed 42
```

4. Değerlendiriciye **yalnızca** `blind_review.csv` gönder. `condition_key.csv` hangi A/B yanıtının hangi koşul olduğunu gösterir; ayrı ve erişimi kısıtlı tutulmalı, GitHub'a veya değerlendiriciye gönderilmemelidir.
5. Aynı vaka içindeki A ve B sırası her vakada rastgele değiştirilir; vaka sırası da karıştırılır. Bir vaka aynı istem için tam bir personalized ve tam bir baseline yanıtı içermelidir.

## Puanlama rubriği

Her iki yanıtı ayrı ayrı değerlendir. Kişinin gerçek kişiliğini taklit etmeyi, psikolojik tanı koymayı veya “duyguyu doğru anlama” iddiasını puanlama.

### 1. İsteme uygunluk / yararlılık (1–5)

- **1:** İsteği büyük ölçüde karşılamıyor; ilgisiz veya yanıltıcı.
- **2:** İsteğin küçük bir bölümünü karşılıyor; önemli eksikler var.
- **3:** Genel olarak ilgili ama kısmen eksik veya sıradan.
- **4:** İsteğe doğrudan cevap veriyor ve büyük ölçüde yararlı.
- **5:** İsteği açık, tutarlı ve uygun kapsamda karşılıyor.

### 2. Üslup tercihlerine uygunluk (1–5)

- **1:** Belirgin biçimde yapay, uygunsuz veya kullanıcının açık iletişim tercihleriyle çelişiyor.
- **2:** Birkaç belirgin uyumsuzluk var.
- **3:** Kabul edilebilir ama bazı üslup özellikleri uygun değil.
- **4:** Dil düzeyi ve iletişim biçimi bağlama çoğunlukla uyuyor.
- **5:** Doğal, tutarlı ve istemde belirtilen iletişim biçimine çok uygun.

Yalnızca kullanıcı tarafından açıkça belirtilmiş veya deney protokolünde önceden tanımlanmış tercihlere göre puan ver; kişilik varsayımı yapma.

### 3. İfade edilen duygusal tona uygunluk (1–5)

- **1:** Yanıtın tonu, istemde açıkça ifade edilen duygu/yoğunlukla ciddi biçimde uyumsuz.
- **2:** Belirgin ton uyumsuzluğu var.
- **3:** Ton nötr veya kısmen uygun.
- **4:** Ton bağlama uygun ve duyarlı.
- **5:** Ton, metinde gerçekten ifade edilen duyguya doğal ve ölçülü biçimde karşılık veriyor.

Bu ölçüt gerçek içsel duyguyu veya VAD modelinin bilimsel doğruluğunu ölçmez; yalnızca metne verilen yanıtın görünür tonunu puanlar.

## Değerlendiriciler ve kayıt

- Mümkünse iki bağımsız değerlendirici kullan; her ikisi koşul etiketini görmemeli.
- Yanıtlar arasındaki farkı puanlamadan önce koşul anahtarını açma.
- Değerlendiriciler arası uyumu raporla (ordinal ölçek için uygun bir istatistik seç ve yöntemini açıkla).
- Değerlendiriciler aynı vakayı puanlarken aynı rubric sürümünü kullanmalı.
- Eksik veya uygulanamaz değerlendirmeleri tahminle doldurma; önceden belirlenmiş kurala göre boş bırak ve raporla.

## Raporlama sınırları

Kör değerlendirme yalnızca puanlanan örneklemde algılanan yararlılık/üslup/ton uygunluğunu destekler. Tek başına kişilik kopyalama doğruluğunu, klinik faydayı veya VAD/Big Five modelinin doğruluğunu kanıtlamaz. Rastgele atama, sabit istemler, koşul sırası ve katılımcı/etik izinler belgelenmeden nedensel iddiada bulunma.


## Gizli anahtarda katılımcı eşleme

Kaynak dosyanın zorunlu sütunları `pair_id,participant_id,prompt_text,response_text,variant` şeklindedir. `participant_id` önceden takma ada çevrilmiş olmalı; anahtar dosyasında saklanır ama değerlendirici paketine aktarılmaz. Böylece kör puanlar raporlanırken her katılımcıdan gelen birden fazla istemin aynı kişi altında kümelenebilmesi sağlanır.
