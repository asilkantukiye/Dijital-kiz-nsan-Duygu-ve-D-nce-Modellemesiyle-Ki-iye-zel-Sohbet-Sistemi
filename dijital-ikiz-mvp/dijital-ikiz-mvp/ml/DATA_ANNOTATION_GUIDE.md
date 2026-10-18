# VAD, Big Five ve üslup veri hazırlama yönergesi

Bu yönerge, Dijital İkiz İnsan Ar-Ge hattı için **veri üretmeden önce izlenecek etik ve ölçüm kurallarını** açıklar. Depodaki CSV dosyaları yalnızca boş şablondur; gerçek kullanıcı örneği veya eğitim verisi değildir.

## Önce etik ve kullanım izni

1. Veri toplamaya başlamadan önce danışman öğretmen ve ilgili kurumla araştırma/etik izin sürecini netleştir. Gerekliyse aydınlatılmış onam, veli/vasi onamı ve okul/kurum izinleri tamamlanmadan veri toplama.
2. Reşit olmayan katılımcıların verilerini gerekli izinler tamamlanmadan toplama veya kullanma.
3. Sohbet metninden ad, kullanıcı adı, telefon, adres, e-posta, okul, hesap ID'si ve diğer doğrudan tanımlayıcı bilgileri çıkar. Ham Supabase `user_id` değerini `participant_id` olarak kullanma.
4. `source` alanına gerçek kaynak türünü/kodunu; `license_or_consent` alanına kaynağın lisansını veya onamın izin verilen kayıt referansını yaz. Bu alanları doldurmak tek başına izin kanıtı değildir; kaynağın şartlarını ayrıca doğrula.
5. Onam belgelerini, eşleştirme anahtarlarını ve kimlik bilgilerini GitHub'a yükleme. CSV'deki participant ID rastgele takma kimlik olmalıdır; gerçek kimlikle ilişkilendiren dosya ayrı, erişimi kısıtlı bir yerde tutulmalıdır.

## Hangi CSV ne içindir?

- `vad_template.csv`: Her metin örneği için valence, arousal ve dominance (0–1).
- `big_five_template.csv`: Katılımcının ayrı bir doğrulanmış kişilik ölçeğinden elde edilmiş beş boyut skorunun her metin örneğine bağlanması. Bir katılımcının birden fazla satırı varsa aynı `participant_id` korunur.
- `style_template.csv`: Metinden çıkarılabilen üslup ölçümleri.

Bir duygu polaritesi etiketi (olumlu/nötr/olumsuz), üç VAD boyutunun yerine geçmez. Genel bir metinden katılımcının Big Five kişiliğini güvenilir biçimde çıkardığını varsayma. Görevler için uygun ve ayrı etiketli veri kullan.

## VAD etiketleme

Her metin örneği, mümkünse birbirinden bağımsız en az iki değerlendirici tarafından; örnek bağlamı ve yönerge aynı tutularak etiketlenmelidir.

### Valence — metinde ifade edilen duygu değerliği

- 0.00: çok olumsuz
- 0.25: olumsuza yakın
- 0.50: nötr, karışık veya açık duygu işareti olmayan
- 0.75: olumluya yakın
- 1.00: çok olumlu

### Arousal — metinde ifade edilen uyarılma/yoğunluk

- 0.00: çok sakin, düşük uyarılma
- 0.25: düşük yoğunluk
- 0.50: orta veya belirsiz yoğunluk
- 0.75: yüksek yoğunluk
- 1.00: çok yüksek uyarılma/heyecan

### Dominance — metinde ifade edilen kontrol/etki hissi

- 0.00: güçsüz, kontrolün kendisinde olmadığını ifade eden
- 0.25: düşük kontrol hissi
- 0.50: nötr veya belirsiz
- 0.75: kendinden emin/kontrollü
- 1.00: çok yüksek kontrol/baskınlık ifadesi

Bu puanlar **yalnızca örnekte ifade edilen durumu** tanımlar; kalıcı kişilik özelliği, psikolojik tanı veya klinik ölçüm değildir. Metin tek başına yeterli değilse puanı tahmin ederek uydurma. Çözülemeyen örnekleri ayrı işaretle, sonra gerekçeli biçimde hariç tut.

## Big Five etiketleme

1. Kişilik puanlarını metni okuyarak tahmin etme. Katılımcıdan onamla toplanmış, Türkçe geçerliği ve kullanım izni doğrulanmış bir kişilik ölçeğinin puanlarını kullan.
2. Ölçek sürümünü, kaynak/lisansını, ters maddelerin nasıl puanlandığını, eksik yanıt kurallarını ve 0–1'e dönüşüm formülünü deney günlüğüne yaz.
3. Aynı katılımcıya ait bütün metinlerde aynı kişilik etiketi kullanılıyorsa bu puanın katılımcı düzeyinde bir hedef olduğunu raporla; her satır bağımsız kişi sayılmaz.
4. Beş boyut için ayrı MAE, RMSE, R² ve korelasyon raporla. Sabit veya çok dar dağılımlı hedeflerde korelasyon/R² tanımsız olabilir; bu durum `null` olarak raporlanmalıdır.

## Üslup etiketleri

- `style_informality`: resmi olmayan ifade düzeyi (0 resmi/resmî, 1 çok samimi/gündelik).
- `style_emoji_rate`: kelime başına emoji oranının 1'de kırpılmış değeri.
- `style_slang_rate`: önceden belgelenmiş argo/kolokyal sözlükteki işaretlerin kelime oranı; sözlük ve sürümü korunmalıdır.
- `style_humor`: metindeki mizah ifadesi için değerlendirici puanı veya önceden tanımlanmış ölçüm kuralı.

Bu tanımlar proje boyunca değiştirilmemelidir. Her etiketleme için veri ve kural sürümü raporlanmalıdır.

## Katılımcı bazında veri bölme

Aynı `participant_id` train, validation ve test kümelerinden **yalnızca birinde** yer almalıdır. Aynı kişinin farklı mesajları test kümesine sızarsa kişi düzeyindeki performans olduğundan iyi görünebilir. Bölüm oranları küçük veri kümelerinde yaklaşık kalabilir; bütün bölüm dosyalarının mevcut ve yeterli büyüklükte olduğunu kontrol et.

Doğrulama komutları:

```bash
python ml/data/validate_dataset.py ml/data/vad.csv --task vad
python ml/data/validate_dataset.py ml/data/big_five.csv --task big-five
python ml/data/validate_dataset.py ml/data/style.csv --task style
python ml/data/split_by_participant.py ml/data/vad.csv ml/data/vad_splits
```

Bölme aracı aynı satır kimliğini tekrar eden örnekleri reddeder ve en az üç ayrı katılımcı gerektirir. Ayrı görevler için split'ler bağımsız olarak üretilebilir; ancak Big Five gibi katılımcı düzeyinde etiketler için aynı kişi hiçbir zaman iki farklı bölüme yayılmamalıdır.

## Raporlama asgari koşulları

- Kaynak ve lisans/onam durumu; veri filtreleme ve hariç tutma sayıları.
- Katılımcı ve örnek sayıları ile train/validation/test dağılımı.
- Etiket yönergesi, etiketleyici sayısı ve mümkünse değerlendiriciler arası uyum.
- Rastgele tohum, model adı/sürümü, hiperparametreler.
- VAD/Big Five için hedef bazında MAE, RMSE, R², Pearson ve Spearman; uygun durumlarda basit referans modelle kıyaslama.
- Veri sınırlamaları, olası kaynak yanlılığı ve sonuçların neyi kanıtlamadığı.

Gerçek etiketli veri ve test sonuçları olmadan doğruluk yüzdesi, kullanıcı benzerliği ya da psikolojik fayda iddiası yazma.
