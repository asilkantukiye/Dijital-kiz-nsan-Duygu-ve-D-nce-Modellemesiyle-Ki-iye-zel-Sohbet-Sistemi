# Hugging Face LoRA adaptörünü sınama

**Durum (29.10.2026):** `hasankb00/dijital-ikiz-qwen3-4b-lora` deposu özel ve yüklemesi doğrulanmış bir LoRA adaptörüdür. Bu depo, bağımsız çalışan tam model veya otomatik açılmış sohbet API'si değildir. Aşağıdaki adımlar adaptörü **ayrı bir Python sürecinde** test etmek içindir; Vercel üretimini değiştirmez.

Model deposu: https://huggingface.co/hasankb00/dijital-ikiz-qwen3-4b-lora

## Seçenek A — Kaggle GPU'da tek deneme (eğitim yapmadan)

1. Kaggle'da yeni bir notebook açıp **Accelerator = GPU** seçin. Bu, model eğitimi çalıştırmaz; yalnızca daha önce yayımlanmış adaptörü yükleyip bir yanıt üretir.
2. Hugging Face'de, özel model deposunu okuyabilen ve temel Qwen modeline erişebilen, yalnızca okuma yetkili bir token oluşturun.
3. Kaggle Notebook → Add-ons/Secrets bölümünde token'ı `HF_READ_TOKEN` adıyla ekleyin. Token'ı kod hücresine, GitHub'a veya çıktılara yazmayın.
4. Aşağıdaki hücreyi çalıştırın. Gerektiğinde ilk hücre paket yükler; sonraki hücre modeli 4-bit yükler ve tek bir Türkçe mesajla sınar.

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
    {"role": "user", "content": "Merhaba. Bu sistemin ne yaptığını kısaca açıklar mısın?"},
]
prompt = tokenizer.apply_chat_template(
    messages,
    tokenize=False,
    add_generation_prompt=True,
)
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

**Başarı ölçütü:** model ve tokenizer hatasız yüklenmeli, çıktı boş olmamalı ve Türkçe yanıt görünmelidir. Bu tek örnek yalnızca teknik yükleme/üretim testidir; modelin bilimsel başarısını veya kişiselleştirme kalitesini kanıtlamaz. Kaggle GPU kotası tüketilebilir.

## Seçenek B — Hugging Face web sitesinde sohbet

Model sayfasında **Inference**/sohbet arayüzü görünmüyorsa bu bir hata olmayabilir: depo özel ve yalnızca PEFT adaptörü içeriyor. Hub'a dosya yüklemek kendi başına web sohbeti başlatmaz. Deneysel olarak sohbet etmek için adaptörü yükleyen uyumlu bir Hugging Face Space ya da Inference Endpoint gerekir. Qwen3-4B, standart ücretsiz CPU donanımında rahatça çalışmayabilir; GPU veya ücretli donanım gerekebilir. Herhangi bir ücretli endpoint/Space donanımı maliyeti onaylanmadan açılmamalıdır.

## Vercel uygulamasına bağlama koşulu

Uygulama şu anda `HF_MODEL=Qwen/Qwen3-4B-Instruct-2507` varsayılanıyla temel modeli çağırır. **`HF_MODEL` değerini doğrudan özel adaptör deposuna çevirmeyin.** Önce adapter'ı gerçekten yükleyen, OpenAI uyumlu `/v1/chat/completions` API'si veren bir serving kurulumunu doğrulayın; ardından Vercel'de `HF_CHAT_COMPLETIONS_URL` olarak o HTTPS endpoint adresini tanımlayın. `HF_TOKEN` sunucu tarafında kalmalı ve endpoint erişimi için gerekli en düşük izinlere sahip olmalıdır. Sonrasında üretimde oturumla `POST /api/chat`, gecikme, hata ve oran sınırı testleri geçmeden entegrasyon tamamlandı sayılmaz.

## Bilinen sınırlar

- Eğitim: `Qwen/Qwen3-4B-Instruct-2507` + genel `TFLai/Turkish-Alpaca` talimat verisi.
- Base test loss: 2,3596; LoRA test loss: 1,4867. Bu kayıp düşüşü tek başına sohbet kalitesini veya bireye benzerliği kanıtlamaz.
- VAD ve Big Five modeli değildir; bu görevler için doğrulanmış test sonuçları yoktur.
- Özel depo lisans ve veri alt kaynakları incelemesi tamamlanana kadar private kalmalıdır.
