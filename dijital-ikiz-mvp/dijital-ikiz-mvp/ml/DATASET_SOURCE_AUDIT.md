# Veri kaynağı denetimi — 24 Ekim 2026

Bu belge, bulunan veri adaylarını görev uyumu ve şu an doğrulanabilen lisans/erişim bilgilerine göre sınıflandırır. Bir platformdaki lisans etiketi, birleşik veri kümesinin tüm alt kaynaklarının kullanımını kendiliğinden yetkilendirmez. Eğitim öncesi veri kartı, orijinal yayın, alt kaynaklar ve yeniden kullanım koşulları tekrar doğrulanmalıdır.

## Karar özeti

| Kaynak | Bildirilen etiketler/ölçek | Lisans ve erişim bulgusu | Karar |
|---|---|---|---|
| [winvoker Türkçe duygu analizi](https://huggingface.co/datasets/winvoker/turkish-sentiment-analysis-dataset) | Olumlu/nötr/olumsuz; kartta yaklaşık 492.782 etiketli örnek bildiriliyor | Hugging Face kartı CC BY-SA 4.0 bildiriyor; farklı kaynaklar listelenmiş. Pilot notebook sürümü `ef87c7a2a7199a8b721c99425933316d35f9af2f` kullanıyor. | **Yalnızca polarite pilotu için**; atıf, paylaşım koşulları ve alt kaynak şartları korunmalı. VAD veya Big Five etiketi değildir. |
| [TFLai Türkçe Alpaca](https://huggingface.co/datasets/TFLai/Turkish-Alpaca) | Yaklaşık 51.914 `instruction/input/output` satırı; genel talimat takibi | Hugging Face metadata'sı Apache-2.0 bildiriyor; veri eski ve örneklerde doğruluk/çeviri hatası riski var. Eğitim revizyonu `90f9589` olarak sabitlendi. | **Sınırlı Qwen QLoRA pilotu**; yalnızca genel talimat başlangıç çizgisi. Örnek kalite denetimi ve kaynak şartları gerekli; kişisel dijital ikiz, VAD veya Big Five etiketi değildir. |
| [nihalenc Türkçe 8-sınıflı duygu](https://huggingface.co/datasets/nihalenc/turkish-8class-emotion-dataset) | 8 kategori: iğrenme, korku, minnet, pişmanlık, mutluluk, öfke, şaşkınlık, üzüntü | Hub sayfasında lisans metadatası görünmüyor. Dosya görüntüleyici CSV ayrıştırma hatası bildiriyor. | **Beklemede:** lisans/izin ve veri bütünlüğü doğrulanmadan kullanma. Kategorik duygu, sürekli VAD değildir. |
| [anilguven Türkçe tweet duygu](https://huggingface.co/datasets/anilguven/turkish_tweet_emotion_dataset) | Yaklaşık 4.000 tweet, duygu sınıfları | Hugging Face lisansı unknown olarak gösteriyor; örneklerde hakaret/küfür olabilir. | **Beklemede:** yazılı lisans/izin ve gizlilik/zararlı içerik denetimi olmadan kullanma. |
| [log101 emotion-turkish](https://huggingface.co/datasets/log101/emotion-turkish) | Çok küçük Türkçe duygu sınıflandırma örnekleri | MIT etiketi görünüyor; train/test/validation dosyaları yaklaşık 135 bayt. | **Eğitim için uygun değil**; yalnızca çok küçük şema denemesi. |
| [TurES Türkçe duygusal konuşma](https://openaccess.mku.edu.tr/items/8c678a05-8ccc-48a4-8636-86ad252d3b2e) | Yayında 5.304 film konuşma kesiti ve kategorik duygu/VAD etiketleri bildiriliyor | Kurumsal kayıt closedAccess diyor; kaynak film sesleri/telif koşulları içeriyor. | **Kullanma:** açık erişim/izin ve metin/ses türevlerinin kullanım hakları doğrulanmadı. |
| [TB5I — Türkçe Big Five görüşme veri kümesi](https://doi.org/10.1109/ACCESS.2026.3672037) | Makale arama özetinde 172 aday, 50 maddelik BFI puanları ve kişi başına beş artırılmış metin varyantı bildiriliyor. | Makale için CC BY 4.0 bildirimi var; bu denetimde ham veri paketi indirme noktası, veri kümesinin ayrı lisansı ve onam/yeniden kullanım şartları doğrulanmadı. | **Beklemede:** yazarların resmî veri deposu ve veri kullanım şartları teyit edilmeden ham veri kullanma. Artırılmış metinler kişi bazında aynı split'te kalmalı. |
| [Türkçe Big Five Inventory uyarlama çalışması](https://www.sciencedirect.com/science/article/pii/S1877042810003769) | Türkçe BFI uyarlama/geçerlik çalışması; makale özetinde 1.153 üniversite öğrencisi | Bu bir metin+kişilik etiketi CSV'si olarak doğrulanmadı. | **Ölçek referansı olabilir; hazır eğitim veri kümesi değildir.** |

## Görevle uyum kuralları

- **Sentiment/polarite** olumlu/nötr/olumsuz ayrımıdır; sürekli valence-arousal-dominance (VAD), Big Five veya kişi düzeyinde “dijital ikiz doğruluğu” değildir.
- **Kategorik duygu** (ör. mutluluk/öfke/korku) otomatik olarak VAD sayısına çevrilmemeli; dönüşüm/etiketleme protokolü olmadan skor uydurulmamalı.
- **VAD regresyonu** için üç boyutun da açık yönergeyle etiketlenmiş, tutarlı biçimde 0–1 aralığına getirilmiş örnekleri gerekir.
- **Big Five regresyonu** için tercih edilen hedef, onamla toplanmış ve Türkçe geçerliği/kullanım izni doğrulanmış bir kişilik ölçeği puanıdır. Metni okuyup kişilik etiketi tahmin etmek, doğrulanmış etiket yerine kullanılamaz.
- Aynı katılımcının tüm mesajları ve aynı metnin artırılmış/kopya biçimleri yalnızca train, validation veya test bölümlerinden **birinde** bulunmalı.

## Kaynağı kullanılabilir sayma kontrolü

1. Resmî lisans veya yazılı izin ve veri sahibini kaydet.
2. Birleşik veri kümelerindeki alt kaynakların şartlarını ayrıca kontrol et.
3. Kolonları, etiket tanımını, sınıf dağılımını, eksik/tekrarlı metinleri incele.
4. Kimlik belirleyici verileri çıkar; ham kullanıcı ID'lerini GitHub'a koyma.
5. Katılımcı/kopya sızıntısı olmayan split'ler oluştur.
6. Gerçek eğitimden sonra kullanılan kaynak, split, tohum, model sürümü ve metrikleri kaydet.

## Eğitim sonrası ek denetim — 27 Ekim 2026

Gerçek Kaggle koşusu 40562948791 başarıyla tamamlandı ve artefakt paketi doğrulandı. Sonuçlar: docs/kaggle-training-results-2026-10-27.md.

- Polarite veri kümesinin Hub README'si, olumlu/olumsuz örneklerin birden çok kaynaktan derlendiğini; nötr örneklerin bir kısmının Türkçe Wikipedia dump'ından, bir kısmının da "Lorem ipsum" gibi rastgele metinlerden geldiğini açıkça belirtiyor.
- Eğitim notebook'u train/test dosyalarını temizleyip aynı normalize edilmiş metin çakışmalarını çıkarıyor; ancak eğitim hedefindeki sütunlar yalnızca text ve label olarak seçildiği için kaynak/dataset alanı model girdisi olarak kullanılmıyor, kaynak bazlı holdout da yapılmıyor.
- Dolayısıyla 3.000 test örneğindeki %94,07 accuracy ve %94,07 macro-F1 yalnızca bu sabitlenmiş veri/test dağılımı için ön sonuçtur. Nötr sınıfın F1 değerinin 0,996 olması gerçek konuşma nötrlüğünün bu doğrulukta çözüldüğünü kanıtlamaz; kaynak veya metin türü ipuçları sonuçları kolaylaştırmış olabilir.
- Yeni CPU-only TF-IDF + LogisticRegression benchmark'ı aynı pilot split üzerinde karşılaştırma noktası oluşturur. Aynı veri setindeki güçlü skorlar, kaynak artefaktı riskini tek başına ortadan kaldırmaz. Sonraki esas değerlendirme, mümkünse kaynak-tutulan bir split ve bağımsız, doğal Türkçe konuşma test kümesi üzerinde yapılmalıdır.
- Qwen3-4B QLoRA pilotunun test loss'u 2,3596'dan 1,4867'ye düştü; bu, genel talimat verisi üzerindeki token kaybı ölçümüdür. Kişiye özgü dijital ikiz, duygu veya kişilik doğruluğu ölçümü değildir.

## Mevcut durum

Polarite ve genel Türkçe talimat pilotları gerçek eğitimle ölçülmüştür; VAD/Big Five/üslup CSV'leri ise boş şablonlardır ve bu görevler için gerçek, izin/lisansı doğrulanmış eğitim verisi bulunmamaktadır. Lisans/alt kaynak incelemesi ve bağımsız kaynak-tutulan değerlendirme tamamlanana kadar %75 genel başarı veya kişilik kopyalama başarısı iddiası desteklenmiyor.
