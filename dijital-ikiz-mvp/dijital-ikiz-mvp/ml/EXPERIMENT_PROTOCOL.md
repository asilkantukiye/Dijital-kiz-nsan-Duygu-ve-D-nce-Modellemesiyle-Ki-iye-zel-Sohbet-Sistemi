# Kişiselleştirilmiş ve genel sohbet koşullarının öncül değerlendirmesi

## Araştırma sorusu

Aynı standart istemlere verilen yanıtlar, kullanıcılar tarafından kişiselleştirilmiş koşulda (`personalized`) genel sohbet koşuluna (`baseline`) kıyasla daha faydalı veya uygun algılanıyor mu?

Bu, MVP'nin algılanan yanıt kalitesine ilişkin keşifsel bir kullanıcı değerlendirmesidir. VAD, Big Five veya kişinin kendini kopyalama doğruluğunu ölçmez.

## Veri toplamadan önce

1. Danışman öğretmen ve okulun araştırma/etik süreciyle planı gözden geçir. Katılımcılardan veri toplamadan önce gerekli bilgilendirilmiş onam, kurum izni ve veri koruma şartlarını tamamla.
2. Gerekli izin ve koruyucu süreçler tamamlanmadan reşit olmayan katılımcıları çalışmaya dahil etme. Çocuklar için ilgili veli/vasi ve kurum izinleri gerekir.
3. Katılımcılara bunun deneysel bir prototip olduğu, profil puanlarının klinik veya doğrulanmış psikolojik ölçümler olmadığı, katılımın gönüllü olduğu ve istedikleri an ayrılabilecekleri açıklanmalıdır.
4. Gerçek ad, e-posta, ham Supabase `user_id`, mesaj metni, sağlık/psikolojik ayrıntı ya da başka doğrudan tanımlayıcı bilgiyi araştırma CSV'sine kopyalama. Rastgele takma kimlik kullan; eşleştirme anahtarı gerekiyorsa GitHub dışında, izinli ve korumalı bir yerde tut.

## Önceden tanımlanmış kısa pilot düzeni

1. Önceden hazırlanmış 5–8 nötr, herkese aynı gösterilen istem belirle. İstemler katılımcının özel veya hassas hayat bilgilerini istememeli.
2. Her katılımcı her istemi iki koşulda da denesin: `personalized` ve `baseline`. İstem metni koşullar arasında aynı olmalı.
3. Koşul sırasını katılımcılar arasında dengeli şekilde değiştir (örneğin yarısı önce personalized, yarısı önce baseline). Sıra gerçekten rastgele atanmadıysa rastgeleleştirme yapıldığını raporda yazma.
4. Her yanıt için aynı 1–5 ölçeği kullan: 1 = hiç uygun/faydalı değil, 5 = çok uygun/faydalı. Ölçekte tek bir tanım kullan ve toplamadan önce değiştirip durma.
5. Mümkünse katılımcıya yanıt hangi koşuldan geldiğini göstermeden yanıtları ayrı, karışık sırada değerlendir. Uygulamanın mevcut ekranında koşul etiketi göründüğü için bu yapılmıyorsa sonuçları **körlenmemiş** olarak tanımla.
6. Katılımcıların her iki koşulu da değerlendirdiğini kontrol et; eksik yanıtları zorla doldurma veya tahmin etme.

## Girdi dosyası ve analiz

Analiz aracı:

```bash
python ml/analyze_feedback.py ml/data/anonymized_feedback.csv --output ml/results/feedback_analysis.json
```

Girdi en az şu sütunları içerir:

```csv
participant_id,variant,rating
P001,baseline,3
P001,personalized,4
```

Yukarıdaki satırlar yalnızca biçim örneğidir; gerçek katılımcı verisi değildir. `participant_id` takma kimlik olmalıdır. Boş dosya şablonu `ml/data/feedback_template.csv` yolundadır.

Birincil ölçüt, iki koşulu da değerlendiren katılımcıların kendi ortalama puanları arasındaki farktır: personalized eksi baseline. Analiz aracı bu farkın bootstrap %95 güven aralığını ve iki taraflı işaret-değiştirme permütasyon testini hesaplar; koşul başına puan sayısı ve katılımcı sayısını da bildirir. Az sayıda eşleştirilmiş katılımcıyla sonuçlar yalnızca öncül bulgu olarak sunulmalıdır.

## Sonuçları dürüst yorumlama

- Pozitif fark, yalnızca bu örneklemde personalized yanıtların daha yüksek puanlandığını gösterir.
- Aynı istemler, dengeli koşul sırası, eksik veri kuralları ve katılımcı sayısı raporda açıklanmalıdır.
- Atama rastgele değilse gözlenen farkı kesin nedensel etki olarak sunma.
- Kullanıcı puanı, modelin duyguyu/kişiliği doğru tahmin ettiğini veya psikolojik fayda sağladığını kanıtlamaz.
- Duygu polaritesi sınıflandırma sonuçlarını sürekli VAD ölçümüyle karıştırma.
- Gerçek veriler analiz edilmeden p-değeri, güven aralığı, başarı yüzdesi veya olumlu sonuç uydurma; %75 hedefini ölçüt ve önceden tanımlı test protokolü olmadan başarı gibi yazma.

## Sınırlılıklar

Bu plan bir uygulama/ölçüm protokolüdür; katılımcı verisi, onay, gerçek kullanıcı testi ya da bilimsel sonuç içermez. Mevcut arayüz koşulu elle değiştirmeye izin verir; rastgele atamayı veya körlemeyi otomatik uyguladığı iddia edilmemelidir. Uygulamanın kendisi de gerçek kullanımda ayrıca test edilmelidir.
