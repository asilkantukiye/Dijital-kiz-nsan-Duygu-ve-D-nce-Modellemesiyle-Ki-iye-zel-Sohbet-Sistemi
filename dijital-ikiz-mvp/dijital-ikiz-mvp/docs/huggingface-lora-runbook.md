# Hugging Face LoRA adaptörünü sınama ve sunma

**Adaptör:** `hasankb00/dijital-ikiz-qwen3-4b-lora` (özel depo)  
**Temel model:** `Qwen/Qwen3-4B-Instruct-2507`  
**Adaptör yapılandırması:** PEFT LoRA, rank 8.

Bu depo bağımsız çalışan tam model veya otomatik açılmış sohbet API'si değildir. Adaptör, temel modelle birlikte çalışan bir çıkarım sunucusuna yüklenmelidir.

Model deposu: https://huggingface.co/hasankb00/dijital-ikiz-qwen3-4b-lora

## 1. Kaggle üzerinde tek üretim testi

Kaggle GPU'da tek deneme, eğitim yapmadan adaptörün yüklenip yanıt ürettiğini doğrular. Var olan Kaggle not defterindeki HF_READ_TOKEN secret'ı kullanılabilir. Token'ı hücreye veya çıktıya yazmayın.

```python
%pip install -q "transformers>=4.51,<5" "peft>=0.15,<1" "accelerate>=1.8" "bitsandbytes>=0.45,<1" "safetensors>=0.5" "huggingface_hub>=0.34"

import torch
from kaggle_secrets import UserSecretsClient
from transformers import AutoTokenizer, AutoPeftModelForCausalLM, BitsAndBytesConfig

token = UserSecretsClient().get_secret("HF_READ_TOKEN")
adapter_id = "hasankb00/dijital-ikiz-qwen3-4b-lora"

tokenizer = AutoTokenizer.from_pretrained(adapter_id, token=token)
quantization = BitsAndBytesConfig(
    load_in_4bit=True,
    bnb_4bit_quant_type="nf4",
    bnb_4bit_compute_dtype=torch.float16,
    bnb_4bit_use_double_quant=True,
)
model = AutoPeftModelForCausalLM.from_pretrained(
    adapter_id,
    token=token,
    device_map="auto",
    quantization_config=quantization,
    torch_dtype="auto",
)
model.eval()

messages = [
    {"role": "system", "content": "Türkçe, açık ve güvenli yanıt ver."},
    {"role": "user", "content": "Bu sistemin ne yaptığını kısaca açıklar mısın?"},
]
prompt = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
inputs = tokenizer(prompt, return_tensors="pt").to(model.device)

with torch.inference_mode():
    output = model.generate(
        **inputs,
        max_new_tokens=160,
        do_sample=False,
        pad_token_id=tokenizer.eos_token_id,
    )

new_tokens = output[0][inputs["input_ids"].shape[-1]:]
print(tokenizer.decode(new_tokens, skip_special_tokens=True))
```

**Başarı ölçütü:** model ve tokenizer hatasız yüklenmeli, yanıt boş olmamalı ve Türkçe olmalıdır. Bu teknik yükleme testidir; kişiselleştirme kalitesini kanıtlamaz. Kaggle GPU kotası tüketilebilir.

## 2. Kalıcı API: Hugging Face Inference Endpoint + vLLM

Bu yol ücretli GPU kullanabilir. Endpoint oluşturmak veya GPU donanımını çalıştırmak öncesinde saatlik fiyatı ve ölçekleme ayarını kontrol edin. Ücretli kaynak bu çalışma tarafından otomatik açılmaz.

1. Hugging Face hesabında **Inference Endpoints → New endpoint** bölümünü açın.
2. Model deposu olarak temel modeli seçin: `Qwen/Qwen3-4B-Instruct-2507`.
3. Engine olarak **vLLM** seçin. Modelin çalışacağı donanımı seçmeden önce tahmini fiyatı kontrol edin; Qwen 4B ve LoRA'yı taşıyabilecek GPU belleği gerekir.
4. Gelişmiş ayarlardaki **Container arguments** alanına aşağıdaki seçenekleri ayrı argümanlar olarak girin:

```text
--enable-lora
--max-lora-rank
8
--max-loras
1
--lora-modules
dijital-ikiz=hasankb00/dijital-ikiz-qwen3-4b-lora
```

5. Endpoint'in çalışma ortamına `HF_TOKEN` adında **secret** ekleyin. Bu token, özel adaptör deposunu okuyabilmelidir. Token değerini repoya veya loglara yazmayın.
6. Endpoint'in erişim korumasını açık tutun. Başlatma tamamlanınca endpoint kartındaki HTTPS URL'yi kopyalayın.
7. vLLM sunucusu hazır olduğunda `/v1/models` adresinden `dijital-ikiz` adapter alias'ının listelendiğini kontrol edin. Görünmüyorsa Vercel ayarına geçmeyin.

vLLM, LoRA sunumunu `--enable-lora` ve `--lora-modules` ile destekler. `--max-lora-rank 8` değeri, yayımlanmış adaptörün rank 8 yapılandırmasıyla eşleşir. Kaynak: https://docs.vllm.ai/en/latest/features/lora/

Hugging Face Inference Endpoints, vLLM motor argümanlarının container arguments ile verilmesini destekler. Kaynak: https://huggingface.co/docs/inference-endpoints/engines/vllm

## 3. Vercel ortam değişkenleri

Endpoint `RUNNING` durumuna geldikten ve `/v1/models` kontrolünden geçtikten sonra Vercel projesinde Production ve Preview için gereken ortamları ayrı ayrı ayarlayın:

| Değişken | Değer |
|---|---|
| `HF_TOKEN` | Endpoint erişimi ve özel adaptör okuması için yetkili, sunucu tarafında saklanan token |
| `HF_MODEL` | `dijital-ikiz` |
| `HF_CHAT_COMPLETIONS_URL` | `https://<endpoint-host>/v1/chat/completions` |

`HF_MODEL` değerine adaptör deposunun tam adını değil, vLLM'e verdiğiniz alias'ı yazın. `HF_CHAT_COMPLETIONS_URL` yalnızca HTTPS Hugging Face Inference Endpoint hostunu kabul eder. Mevcut `lib/huggingface.ts` sağlayıcısı bu URL'ye `Authorization: Bearer HF_TOKEN` başlığı ve `HF_MODEL` adıyla istek gönderir; ayrı bir API anahtarı kod değişikliği gerekmez.

Ortam değişkenlerini kaydettikten sonra yeni deployment alın. Gizli anahtarı istemci tarafına, `NEXT_PUBLIC_*` değişkenine veya GitHub'a koymayın.

## 4. Uçtan uca kabul testleri

1. Endpoint `/v1/models` yanıtında hem temel model hem `dijital-ikiz` alias görünür.
2. Endpoint'e doğrudan `model: "dijital-ikiz"` ile `POST /v1/chat/completions` gönderildiğinde HTTP 200 ve boş olmayan Türkçe metin alınır.
3. Vercel `POST /api/chat` çağrısı oturumla HTTP 200 döndürür.
4. Vercel deployment loglarında gizli token veya kullanıcı mesajı bulunmaz.
5. Endpoint durdurulduğunda uygulama kontrollü hata verir; tekrar açıldığında istek yeniden çalışır.
6. İki farklı üslup profiliyle aynı test mesajı çalıştırılır; genel ve kişiselleştirilmiş koşullar ayrı ayrı kayıt altına alınır.

Yalnızca HTTP 200 almak adaptörün kullanıldığını kanıtlamaz. `/v1/models` alias kontrolü ve `model: "dijital-ikiz"` isteği zorunludur.

## 5. Maliyet ve soğuk başlangıç

Hugging Face ölçeklemeyi sıfıra indirmeyi destekler. Sıfıra ölçeklenen endpoint boşta donanım maliyetini önler; ancak ilk istekte model yeniden başlatılacağından gecikme oluşur. Her zaman açık minimum replica daha hızlıdır fakat sürekli ücret doğurabilir. Deneysel kullanımda mümkün olan en düşük replica ve scale-to-zero tercih edilmeli, demo zamanı öncesinde endpoint bilinçli şekilde başlatılmalıdır.

Kaynak: https://huggingface.co/docs/inference-endpoints/guides/autoscaling

## 6. Bilinen bilimsel sınırlar

- Eğitim verisi `TFLai/Turkish-Alpaca` genel Türkçe talimat verisidir. Bu eğitim tek başına kullanıcının kişisel üslubunu öğrenmiş bir model üretmez.
- Base test loss: 2,3596; LoRA test loss: 1,4867. Bu kayıp düşüşü sohbet kalitesini veya kişiselleştirme başarısını tek başına kanıtlamaz.
- Uygulamadaki A/B koşulları aynı `HF_MODEL` ile çalıştırılmalıdır. Böylece tek değişken profil koşullandırması olur; LoRA iki koşulda da aynı kalır.
- VAD ve Big Five doğrulanmış model çıktısı olarak sunulmamalıdır.
- Özel adaptör deposu, veri/lisans incelemesi tamamlanana kadar private kalmalıdır.
