# TÜBİTAK 2204-A 2026–2027 uyum ve finalistlik denetimi

**Denetim tarihi:** 29 Ekim 2026  
**Kapsam:** Çağrı şartları, resmî sayfadan erişilebilen değerlendirme formları, mevcut proje raporu, GitHub deposundaki uygulama/eğitim kayıtları ve Hugging Face model paketi.

> Bu doküman bir uygunluk incelemesidir; TÜBİTAK kararı veya finalistlik garantisi değildir. Başvuru göndermeden önce resmî sayfada çağrı ve değerlendirme belgelerinin son sürümü yeniden kontrol edilmelidir.

## 1. Resmî çerçeve

- **Başvuru son tarihi:** 4 Ocak 2027, saat 17.30 (Türkiye saati). Başvuru TYBS üzerinden yapılır; öğrenci ve varsa danışman ARBİS bilgileri güncel olmalıdır.
- **Ana alan:** Yazılım, projenin somut çıktısı bir yazılım prototipi olduğu için uygun bir seçimdir.
- **Tematik alan:** Resmî tematik alan listesinde “Dijital İkiz” başlığı bulunuyorsa bu proje için en doğrudan eşleşmedir. TYBS'de başvuru sırasında seçilen alanı sonradan değiştirmek mümkün olmayabileceğinden son seçimi içerikle birebir eşleştirin.
- **Öğrenci ve özgünlük koşulları:** Türkiye/KKTC'de öğrenim gören lise öğrencileri başvurabilir; proje başına en çok üç öğrenci ve bir danışman bulunabilir. Son başvuru tarihinde öğrencilerin 20 yaşından gün almamış olması gerekir. Proje öğrencilerin kendi özgün düşüncelerinden kaynaklanmalı, kendi bilgi ve becerileriyle geliştirilmiş ve başvuru anında tamamlanmış olmalıdır. Fikir aşamasındaki/devam eden proje kabul edilmez.
- **Önceki yarışma kısıtı:** Çağrı, aynı veya benzer içerikli projenin son başvuru tarihinden önce başka bir proje yarışmasına sunulması hâlinde elenme riski belirtir. Bu nedenle aynı/benzer projeyi başka bir yarışmaya göndermeden önce çağrı hükmünü dikkatle kontrol edin.
- **Rapor biçimi:** Resmî yazım şablonu kullanılmalı; Türkçe tek PDF yüklenmeli; özet 150–250 kelime, rapor ise başlıklar dâhil 2–20 sayfa olmalıdır. Proje adı en fazla 15 kelimedir. Ek belgeler için çağrıda belirtilen dosya adı/uzunluğu ve boyut koşulları ayrıca geçerlidir.
- **Katılımcı araştırması ve izin:** Anket, görüşme veya odak grup gibi veri toplama aracı kullanılıyorsa çağrının ilgili maddeleri uyarınca gönüllü katılım/onam belgeleri ve gereken araştırma izinleri hazırlanmalıdır. MEB'e bağlı öğrenci, veli veya personel hedefleniyorsa MEB araştırma uygulama izni gereklilikleri kontrol edilmelidir. Reşit olmayanlarla çalışmada gerekli veli onamı ve diğer izinler tamamlanmadan araştırmaya başlanmamalıdır.
- **Etik ve doğruluk:** Uydurma/çarpıtılmış sonuç, kaynaksız bilgi, gizlilik ihlali, gerekli iznin eksikliği veya projenin öğrencilerce geliştirilmediğinin anlaşılması elenme sebebi olabilir. Başvuru raporunda marka/şirket tanıtımı yapılmamalıdır.
- **Başarı yolu:** Bölge aşamasında birinci olan projeler final aşamasına davet edilir; bu yüzden hedef yalnızca yazılımı göstermek değil, bölge jürisine araştırma sorusu, yöntem, kanıt ve proje hâkimiyetiyle cevap verebilmektir.

## 2. Değerlendirme ölçütleri

TÜBİTAK'ın şu an resmî sayfasından erişilebilen ön değerlendirme formu 2025 tarihli formdur: Problem/ihtiyacın tanımı ve araştırma sorusu %20, yöntem %20, yaratıcılık ve etki %30, sonuçlar ve tartışma %30. Şu an erişilebilen bölge/final değerlendirme formunda ise problem/araştırma sorusu %15, yöntem %10, yaratıcılık/etki %15, sonuçlar/tartışma %20, sunum ve projeye hâkimiyet %40'tır. Bunlar son 2027 formunun yayımlandığını kanıtlamaz; son başvuru öncesi yeni form yayımlanmış mı kontrol edilmelidir.

Bu ağırlıklar, projede en yüksek önceliğin gerçek ve tekrar üretilebilir sonuçlara, açık yönteme ve öğrencinin çalışmayı kendisinin açıklayabilmesine verilmesi gerektiğini gösterir.

## 3. Projede doğrulanmış olanlar

- Uygulamanın Next.js/Supabase/Hugging Face/Vercel mimarisi ve kullanıcı verisini ayırmaya dönük güvenlik kontrolleri kod deposunda bulunmaktadır.
- 29 Ekim 2026 tarihinde GitHub CI çalıştırması (PR #149 sonrası commit `a8fee240656b25ecdc98d5d862b760bcc0fad307`) test ve production build aşamalarını geçti.
- Kaggle eğitim çalışması `40897581853` tamamlandı; doğrulanmış model paketi SHA-256: `f143275dd908bf8b3273218601807ae626ada31343490acc0bce7bea5c9f8126`.
- Yayın adımı `40915013003`, ikinci denemede başarılı oldu. Özel Hugging Face deposunda LoRA adaptörü, tokenizer dosyaları, `training-metrics.json`, `scientific-validation-report.md` ve artefakt manifesti bulunuyor.
- Türkçe üç sınıflı duygu polaritesi pilotu 3.000 test örneğinde accuracy=0,9407 ve macro-F1=0,9407 raporladı.
- Qwen3-4B genel Türkçe talimat QLoRA pilotunda temel model test loss'u 2,3596, ince ayarlı model test loss'u 1,4867 olarak raporlandı.

## 4. Hazır kabul edilemeyecek noktalar

1. **Polarite sonucu hedeflenen %75 kişiselleştirme başarısı değildir.** Test ölçümü olumlu/nötr/olumsuz sınıflandırması içindir; VAD, Big Five veya sohbetin bireye benzerliği ölçülmemiştir. Veri kümesinde katılımcı kimlikleri yoktur ve nötr sınıfın kaynak türünden ipuçları taşıma riski vardır.
2. **VAD ve Big Five eğitilip değerlendirilmedi.** Doğrulanmış, izin/lisansı belirli ve doğru etiketli veri sağlanmadığı için metrik yoktur. Uygulama profili `lib/twin.ts` öğrenilmiş psikometrik model değil, deneysel sezgisel başlangıçtır.
3. **Qwen LoRA uygulamada canlı olarak kullanılmıyor.** Yüklenen depo bağımsız çalışan tam model değil, `Qwen/Qwen3-4B-Instruct-2507` için PEFT adaptörüdür. Uygulamanın varsayılanı hâlen temel Qwen modelidir. Uyumluluğu doğrulanmış servis veya birleştirilmiş model ve canlı istek testi olmadan uygulamanın ince ayarlı modeli kullandığı söylenemez.
4. **Canlı üretim ortamı doğrulanmadı.** Bu incelemede Vercel dağıtımları/ortam değişkenleri yetki kısıtı nedeniyle okunamadı. Bu nedenle güncel üretim sürümü, `/api/health`, Upstash ve son güvenlik commit'inin yayında olduğu iddia edilmiyor.
5. **Kontrollü kişiselleştirme deneyi yok.** Aynı istemler üzerinde genel ve kişiselleştirilmiş koşulları karşılaştıran, önceden tanımlı ölçütleri ve kör insan puanlaması olan sonuç bulunmuyor.
6. **Mevcut PDF'nin başvuruya uygun son sürüm olmadığı açık.** Raporda boş kaynak atfı `[]`, uygulama geliştirilmemiş gibi yazılan bulgular, ölçülmemiş %75 hedefi ve psikolojik/akran zorbalığı faydalarına ilişkin kanıtlanmamış ifadeler bulunuyor. Bu ifadeler gerçek prototip ve deney kayıtlarıyla yeniden yazılmalı; her atıf doğrulanmalı.
7. **Kaynakça denetimi gerekli.** Özellikle “Almoraes & Alismail (2022)” künyesi bağımsız ve güvenilir bibliyografik kaynaktan doğrulanmadan kullanılmamalı; doğrulanamıyorsa çıkarılmalı ve yerine gerçekten erişilip incelenmiş kaynak eklenmeli.
8. **Lisans/etik belgeleri tamamlanmalı.** Veri kümelerinin genel lisans etiketi alt kaynakların tüm kullanım haklarını tek başına kanıtlamaz. Kullanıcı verisi veya katılımcı değerlendirmesi kullanılacaksa izin, veri minimizasyonu, gönüllülük ve saklama/silme prosedürü belgeye bağlanmalı.

## 5. Önerilen araştırma odağı

Finalistlik açısından proje kapsamını ölçülemeyen iddialarla genişletmek yerine tek bir ana soruya bağlamayı öneriyorum:

**Önerilen araştırma sorusu:** “Türkçe bir sohbet sisteminde kullanıcının ifade biçimine göre koşullandırılan yanıtlar, aynı temel modelin genel yanıtlarına kıyasla kör değerlendiricilerce daha uyumlu ve tutarlı bulunuyor mu?”

Bu soru duygu ve üslup kişiselleştirme hedefini korur ama doğrudan sınanabilir. Big Five ve psikolojik yarar iddiaları, geçerli veri ve izinle ayrı bir çalışma yapılana kadar ana başarı iddiasından çıkarılmalıdır. Duygu polaritesi pilotu destekleyici modül olarak raporlanmalı, VAD başarısı diye adlandırılmamalıdır.

### Önerilen deney planı

1. Önceden belirlenmiş Türkçe istemlerden bir test kümesi oluşturun; test istemlerini eğitim verisinden ayırın.
2. Her istem için iki koşul üretin: (A) aynı temel modelle genel yanıt, (B) aynı model ve aynı isteme deneysel profil/üslup koşullandırması. Değişen şeyin yalnızca kişiselleştirme koşulu olduğundan emin olun.
3. Birincil ölçütü önceden belirleyin: örneğin kör değerlendiricinin 1–5 aralığında “üslup uyumu” puanı. Tutarlılık, yanıt uygunluğu ve güvenlik için ayrı ikincil ölçütler tanımlayın. Bu puanları “%75 doğruluk” diye adlandırmayın.
4. Yanıtları koşul adı gizlenerek rastgele sırayla değerlendirin; değerlendirme yönergesini, örnek sayısını, eksik verileri ve puanlama yöntemini raporlayın. Uygunsa iki değerlendirici ve değerlendiriciler arası uyum raporlayın.
5. Ortalama farkı, dağılımı ve güven aralığını raporlayın; sonuç olumlu değilse onu da olduğu gibi yazın. Bu deney için gereken onam/izin tamamlanmadan insan katılımcı verisi toplamayın. Alternatif olarak sentetik/uzman tarafından hazırlanmış istemlerle teknik karşılaştırma yapın ve kapsamını açıkça belirtin.
6. Testleri tekrarlayın ve tüm komutları, model revizyonunu, veri sürümünü, seed'i, ham skorları ve sınırlılıkları saklayın.

## 6. Eylem planı ve kabul kapıları

| Öncelik | Yapılacak iş | Tamamlandı sayılma koşulu |
|---|---|---|
| P0 | Proje raporunu gerçek duruma göre baştan düzenleme | Boş atıf kalmaması; amaç-yöntem-bulguların birbiriyle uyuşması; her sayının kaynak dosyası olması; 2–20 sayfa, 150–250 kelime özet ve en çok 15 kelimelik başlık koşullarının son dosyada yeniden sayılması |
| P0 | %75 hedefini işlemsel tanımlama | Tek görev + tek birincil metrik + bağımsız test + önceden yazılı başarı ölçütü |
| P0 | Kişiselleştirme karşılaştırması | Aynı istem seti üzerinde genel ve kişiselleştirilmiş koşulların kör karşılaştırması; yöntem, ham puanlar ve sınırlılıklar raporlanmış |
| P0 | Kaynakça ve veri lisansı denetimi | Her kaynağın DOI/kalıcı bağlantısı ve kullanım şartı kontrol edilmiş; belirsiz kaynak çıkarılmış veya açıklığa kavuşturulmuş |
| P0 | Canlı sistemin doğrulanması | Son commit üretimde; sağlık kontrolü ve oturum, sohbet, kullanıcılar arası izolasyon, silme, rate limit ve sağlayıcı hatası testleri başarılı |
| P1 | LoRA'yı uygulamaya bağlama | Uyumlu inference sunucusu/merge edilmiş ağırlık; test yanıtı; gecikme, hata ve maliyet kontrolü. Ücretli uç nokta, maliyeti açıkça kabul etmeden açılmamalı |
| P1 | Polarite dış-korpus kontrolü | Bağımsız veya kaynak-tutulan test ve TF-IDF + LogisticRegression baseline karşılaştırması |
| P2 | VAD/Big Five | Yalnızca uygun etiketli veri, izin/lisans, ölçek geçerliliği ve etik prosedür varsa ayrı deney; aksi hâlde “gelecek çalışma” olarak bırakılması |
| P2 | Gerçek katılımcılı çalışma | Gerekli okul/kurum izni ve onam tamamlandıktan sonra, veri minimizasyonu ve silme prosedürüyle yürütülmesi |

## 7. Metin ve kod yorumları

- Gereksiz şablon metin, tekrarlanan açıklamalar, kullanılmayan yorumlar, boş kaynaklar ve eskimiş dokümantasyon temizlenebilir.
- Güvenlik gerekçesini, veri kaynağını, lisans bilgisini veya deney sınırlılığını açıklayan yorumlar korunmalıdır.
- Metinler doğal ve proje ekibinin anlayıp sözlü olarak savunabileceği bir dille yeniden yazılmalıdır. Kaynak, yöntem, sonuç ve yapay zekâdan alınan yardıma ilişkin varsa kurum/yarışma kuralları doğru uygulanmalı; katkılar gizlenmemeli veya sahte bir insan yazarlığı izlenimi oluşturulmamalıdır.

## 8. Resmî kaynaklar

- TÜBİTAK 2204-A yarışma sayfası ve başvuru takvimi: https://tubitak.gov.tr/tr/yarismalar/2204-lise-ogrencileri-arastirma-projeleri-yarismasi
- 2026–2027 çağrı metni (başvuru koşulları ve rapor biçimi): https://tubitak.gov.tr/sites/default/files/2026-09/Ek-1b_2204_A_cagri_metni_2026-2027_17.08.2026_onaya_sunulan_v2.pdf
- 2027 proje rehberi: https://tubitak.gov.tr/sites/default/files/2026-09/lise_proje_rehberi_2027_onaya_sunulan.pdf
- Şu an resmî sayfadan bağlantısı bulunan ön değerlendirme formu (2025): https://tubitak.gov.tr/sites/default/files/2025-11/on_degerlendirme_kriterleri_2025_web.pdf
- Şu an resmî sayfadan bağlantısı bulunan bölge/final formu (2025): https://tubitak.gov.tr/sites/default/files/2025-11/sergi_kriterleri_2025_web.pdf
- Özel LoRA modeli ve kanıt dosyaları: https://huggingface.co/hasankb00/dijital-ikiz-qwen3-4b-lora
- Yayınlama doğrulaması: https://github.com/asilkantukiye/Dijital-kiz-nsan-Duygu-ve-D-nce-Modellemesiyle-Ki-iye-zel-Sohbet-Sistemi/actions/runs/40915013003

**Net karar:** Proje konusu Yazılım + Dijital İkiz eşleşmesi bakımından uygun görünmektedir. Fakat mevcut PDF ve araştırma kanıtları, tüm iddialarıyla başvuruya hazır değildir. En güçlü yol; iddiaları daraltıp birincil araştırma sorusunu ölçmek, gerçek uygulama durumunu rapora taşımak, bilimsel ve etik kanıtları tamamlamak ve üretim kurulumunu ayrı olarak doğrulamaktır.
