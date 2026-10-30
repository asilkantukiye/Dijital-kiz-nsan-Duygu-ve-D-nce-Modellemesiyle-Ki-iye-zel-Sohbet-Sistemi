# Kör üslup A/B değerlendirme kılavuzu

## Amaç ve kapsam

Bu protokol, aynı Türkçe istem için üretilen genel ve üslup profiliyle koşullandırılmış iki yanıtı, koşul etiketlerini bilmeyen değerlendiricilerin karşılaştırması içindir.

Birincil sonuç **üslup uyumu** puanıdır. İkincil sonuçlar görev uygunluğu ve tutarlılıktır. Bu deney duygu tanıma, VAD, Big Five, psikolojik fayda, klinik geçerlilik veya kullanıcının kimliğini kopyalama başarısını ölçmez.

## Değerlendiriciye verilecek dosyalar

Değerlendiricilere yalnızca kör değerlendirme dosyasının içeriği ve bu kılavuz verilir. condition-key.json, run-manifest.json, endpoint bilgisi veya model koşul adları paylaşılmaz. Koşul anahtarı, puanlama tamamlanana kadar deney yürütücüsünde kapalı tutulur.

Her kayıtta case_id, ortak istem, hedef üslup ve response_1 / response_2 bulunur. friendly, formal ve concise profillerinin hedefleri sırasıyla samimi-gündelik, resmî-ölçülü ve kısa-doğrudan anlatımdır. Değerlendirici hangi yanıtın hangi deney koşulundan geldiğini öğrenmemelidir.

## Puanlama ölçeği

Her iki yanıtı da birbirinden bağımsız puanlayın. Puanları tartışarak uzlaştırmayın. Yanıtın anlamını beğenmek ile istenen üsluba uyumunu karıştırmayın.

| Ölçüt | 1 | 3 | 5 |
|---|---|---|---|
| Üslup uyumu (birincil) | Hedef üsluba belirgin biçimde aykırı | Kısmen uyumlu; tutarsız işaretler var | Hedef üsluba açık ve tutarlı biçimde uyuyor |
| Görev uygunluğu (ikincil) | İstemi karşılamıyor veya konu dışı | İstemi kısmen karşılıyor | İstemi doğrudan ve yeterli karşılıyor |
| Tutarlılık (ikincil) | Çelişkili, kopuk veya anlaşılmaz | Genel olarak anlaşılır, yer yer kopuk | Açık, tutarlı ve kolay izlenebilir |

2 ve 4 puan, iki komşu açıklama arasındaki durumu ifade eder. Puanlar tam sayı olmalıdır. Herhangi bir güvenlik ihlali görülürse, bunu ayrı serbest notlar ya da kişisel veri içerebilecek bir alana yazmak yerine deney yöneticisine sözlü olarak bildirin; bu ilk sürümün puan CSV'si serbest metin kabul etmez.

## Değerlendirici sayısı ve veri kalitesi

- Her yanıt çifti en az iki bağımsız değerlendirici tarafından puanlanmalıdır; mümkünse üç değerlendirici kullanın.
- Değerlendiriciler birbirlerinin puanlarını görmemeli ve puanlama sırasında koşul anahtarına erişmemelidir.
- Aynı değerlendirici aynı case_id çiftini bir kez puanlamalıdır.
- Bir değerlendirme eksikse puan uydurmayın. Analiz aracı her çiftte en az iki değerlendirici olmasını zorunlu tutar.
- Katılımcı veya değerlendirici adı, e-posta, ham kullanıcı kimliği, sohbet geçmişi veya hassas bilgi kullanmayın. E01, E02 gibi takma kodlar kullanın.

## Puan dosyası

ml/evaluation/style-ab-score-template.csv dosyasını kopyalayın. Her satır tek bir değerlendiricinin tek bir yanıt çiftine verdiği puanları içerir. response_1_* ve response_2_* alanları kör dosyadaki yanıt sırasıyla birebir eşleşmelidir.

Puanlamadan önce kör paketi ya da koşul anahtarını değiştirmeyin. Serbest metin veya ek kolon eklemeyin; analiz aracı beklenmeyen kolonları kişisel veri sızıntısını önlemek için reddeder.

## Analiz

Tüm puanlar tamamlandıktan sonra puan CSV'sini deney çalıştırmasının yerel ml/private/ klasöründeki ilgili run dizinine evaluator-scores.csv adıyla kaydedin. Ardından:

    python ml/analyze_style_ab_scores.py --run-dir ml/private/style-ab-runs/<run-id>

Araç koşul anahtarını yalnızca analiz aşamasında açar. Rapor, değerlendirici kimliklerini, ham puanları, istem metnini ve yanıt metnini içermez.

Aynı istem, üç sentetik hedef üslup için tekrar kullanıldığı için istatistiksel çıkarım birimi tekil yanıt satırı değil, **benzersiz istem kümesidir**. Birincil üslup uyumu farkı bu kümeler üzerinden bootstrap %95 güven aralığı ve iki taraflı işaret-değiştirme permütasyon testi ile özetlenir. İkincil ölçütler yalnızca tanımlayıcı olarak raporlanır.

Bu analiz betiği değerlendiriciler arası güvenilirlik katsayısı hesaplamaz. Böyle bir katsayı gerekiyorsa yöntem ve eşikler puanlar görülmeden belirlenmeli ve ayrı doğrulanmış bir analizle raporlanmalıdır.

## Raporlama sınırları

Bu 30 maddelik sentetik pilot, yalnızca yöntem ve teknik akış kontrolüdür. Gerçek kullanıcı genellemesi veya TÜBİTAK başarısı kanıtı değildir. Küçük örneklem, sentetik profiller, sabitlenmiş test istemleri ve sezgisel profil çıkarımı sonuçların sınırlılıkları olarak raporlanmalıdır. Sonuçlar desteklemese bile hipotez ve ölçülen fark aynen raporlanır. Veri olmadan skor, p-değeri, güven aralığı veya başarı yüzdesi yazılmaz.

## Gizlilik

Kör paket, koşul anahtarı ve puanlama CSV'si yerel ml/private/ dizininde tutulur. Bu klasör .gitignore tarafından dışlanmıştır. Bu dosyalar GitHub'a, Hugging Face'e veya herkese açık proje raporuna yüklenmemelidir. Sonuç raporu yalnızca toplulaştırılmış istatistikleri içerir.
