# Model Kartı — MVP Üretici Model

## Model

MVP sohbet üretiminde `Qwen/Qwen3-4B-Instruct-2507` kullanılmaktadır.

Hugging Face model kartında modelin Inference Providers ve Kaggle/notebook kullanım yolları bulunduğu, lisansın Apache-2.0 olduğu ve modelin 4B sınıfında olduğu görülmektedir.

## Kullanım amacı

Model, dijital ikiz profilinden gelen deneysel göstergeler ve konuşma bağlamı ile Türkçe sohbet yanıtı üretmek için kullanılır.

## Önemli sınır

Bu üretici modelin seçilmiş olması, duygu veya kişilik tahmin doğruluğunun kanıtlandığı anlamına gelmez. Duygu ve kişilik modeli değerlendirmesi ayrı veri kümesi ve test protokolü ile yapılmalıdır.

## MVP çıkarımı

`lib/twin.ts` içindeki profil özellikleri şu aşamada heuristic baseline'dır. Bunların daha sonra etiketli veri üzerinde eğitilmiş/ölçülmüş modellerle değiştirilmesi planlanmaktadır.

## Deneysel karşılaştırma

Araştırma aşamasında en az iki koşul önerilir:

1. Genel sohbet: kullanıcıya ait dijital ikiz profilinin modele verilmediği koşul.
2. Kişiselleştirilmiş sohbet: profil koşullandırmasının kullanıldığı koşul.

Her iki koşul aynı değerlendirme kriterleriyle karşılaştırılmalıdır.

## Kaynak

Qwen model kartı:
https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507
