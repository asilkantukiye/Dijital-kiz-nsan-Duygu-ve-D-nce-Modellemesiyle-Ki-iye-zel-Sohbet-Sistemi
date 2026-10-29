# TÜBİTAK Proje Haritası

## Rapor basamakları → yazılım ve deney karşılığı

### 1. Veri toplama, ön işleme ve etiketleme

Tek Kaggle notebook'u ml/kaggle/dijital_ikiz_training.ipynb kullanılır. Polarite pilotu sabitlenmiş Türkçe veri kaynağında gerçek eğitim/test koşusuyla tamamlandı. Qwen talimat pilotu da genel Türkçe talimat verisinde gerçek QLoRA koşusuyla tamamlandı. Ayrıntılar ve sayılar docs/kaggle-training-results-2026-10-27.md dosyasında.

**Henüz tamamlanmayan:** VAD ve Big Five için kaynak, izin/lisans ve hedef etiketleri doğrulanmış uygun CSV veri setleri yok; bu görevler eğitilmiş olarak gösterilmemelidir. Polarite veri kaynağının alt kaynak ve lisans şartları ayrıca gözden geçirilmelidir.

### 2. Duygu ve kişilik analizi

- **Duygu polaritesi:** BERTurk sınıflandırıcı test accuracy 0,9407 ve macro-F1 0,9407 raporladı. Bu yalnızca sabitlenmiş kaynak korpusundaki olumlu/nötr/olumsuz etiketleri için ön pilottur. Kaynak README'si nötr sınıfta Wikipedia ve rastgele metin bulunduğunu belirttiği için kaynağa/genre'a özgü ipuçları olasılığı vardır; bağımsız doğal sohbet ve source-heldout testi yapılmadan genel kullanıcı sohbetlerine genellenmemelidir. CPU-only TF-IDF + LogisticRegression karşılaştırması ayrıca ekleniyor.
- **VAD / Big Five:** Bu görevler henüz gerçek, uygun etiketli veriler üzerinde eğitilip ölçülmedi.
- **Profil çıkarımı:** Uygulamadaki lib/twin.ts hâlen deneysel heuristic/baseline göstergeler kullanır. Eğitimli polarite sınıflandırıcısının çıktısı, web sohbetinde doğrulanmış bir kişilik veya psikolojik değerlendirme gibi kullanılmamalıdır.

### 3. Bireysel ifade biçimi

MVP, temel üslup göstergelerini sayısal profile dönüştürür. Bu yaklaşım henüz katılımcı verisi üzerinde kalibre edilmiş ve bağımsız insan değerlendirmesiyle doğrulanmış bir üslup modeli değildir. Embedding tabanlı ve kişiye özgü modelleme sonraki Ar-Ge hedefidir.

### 4. Kişiye özel sohbet sistemi

app/api/chat/route.ts kullanıcı oturumunu sunucu tarafında doğrular, kullanıcıya ait konuşma geçmişi ve (kişiselleştirilmiş koşulda) bellek bağlamıyla sohbet sağlayıcısını çağırır. Profilin koşullandırılması deneysel bir baseline'dır.

Qwen3-4B QLoRA pilotunda test loss 2,3596'dan 1,4867'ye indi. LoRA adaptörü 29.10.2026 tarihinde `hasankb00/dijital-ikiz-qwen3-4b-lora` özel Hugging Face deposuna yüklendi ve dosya/manifest/rapor doğrulaması geçti (Kaggle run `40897581853`; publisher run `40915013003`, attempt 2). Bu, uygulamanın adaptörü çalıştırdığı anlamına gelmez: uygulama hâlen temel Qwen modelini seçiyor. Eğitim kaybındaki iyileşme, kişiye özel yanıtların daha kaliteli olduğunu tek başına kanıtlamaz.

### 5. Test, değerlendirme ve uygulama

- **Otomatik yazılım doğrulaması:** Ana dal CI çalıştırması d4e44c3f859d555f0ef918b053f778b489e26710 commit'inde PostgreSQL migration/entegrasyon testleri, embedding bütünlüğü, eşzamanlı profil ve hız sınırı testleri, birim testleri, TypeScript ve build adımlarını başarıyla tamamladı.
- **Silme-yarışı koruması:** Canlı Supabase'e 20261027200805_delete_my_chat_inflight_claims migration'ı uygulandı; sohbet verisi silinirken devam eden eski isteklerin sonradan mesaj veya bellek kaydetmesini engelleyen generation kilitleri eklendi.
- **Bilimsel değerlendirme:** Kontrollü kullanıcı/uzman kör değerlendirmesi, genel sohbet–kişiselleştirilmiş sohbet A/B karşılaştırması, örneklem planı ve istatistiksel sonuçlar henüz mevcut değildir. Polarite pilotunun kaynak/genre karışıklığı için bağımsız test ve basit TF-IDF baseline da tamamlanmadan geniş doğruluk iddiası verilmemelidir.
- **Dağıtım:** Son Vercel üretim dağıtımına ve ortam değişkenlerine bu denetim sırasında erişim doğrulanamadı. Canlı sağlık kontrolü, Upstash bağımlılıkları ve iki kullanıcıyla uçtan uca testler tamamlanana kadar yeni güvenlik kodunun üretimde çalıştığı varsayılmamalıdır.

## TÜBİTAK raporunda kullanılabilecek mevcut ifade

Proje; kullanıcı verisi izolasyonu, idempotent sohbet kaydı ve güvenli veri silme gibi üretim odaklı korumaları olan çalışan bir yazılım prototipidir. Türkçe duygu polaritesi ve Qwen3-4B QLoRA pilotları için gerçek eğitim metrikleri elde edilmiştir. Bununla birlikte VAD/Big Five sonuçları, özel adaptörün web uygulamasına entegrasyonu ve genel sohbet ile kişiselleştirilmiş sohbetin kontrollü kullanıcı değerlendirmesi henüz kanıtlanmamıştır. Bu nedenle polarite sonucu veya Qwen test loss'u bütün projenin başarısı ya da hedeflenen “%75 başarı” olarak sunulmamalıdır.
