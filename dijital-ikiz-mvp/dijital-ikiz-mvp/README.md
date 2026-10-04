# Dijital İkiz İnsan — MVP

TÜBİTAK projesi için ilk çalışan prototip: Next.js + Supabase + Hugging Face Inference Providers + Qwen3-4B-Instruct-2507.

## 1. Gereksinimler
- Node.js 20+
- Supabase hesabı/projesi
- Hugging Face token (Inference Providers izni)

## 2. Kurulum
```bash
npm install
copy .env.local.example .env.local
```
Windows PowerShell kullanıyorsan `Copy-Item .env.local.example .env.local` de olur.

`.env.local` içine:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `HF_TOKEN`
- `HF_MODEL=Qwen/Qwen3-4B-Instruct-2507`

## 3. Supabase
Supabase SQL Editor'e `supabase/schema.sql` içeriğini yapıştırıp çalıştır.

## 4. Çalıştır
```bash
npm run dev
```
Sonra http://localhost:3000 adresini aç.

## 5. Mimari
Kullanıcı mesajı → deneysel profil çıkarımı → Supabase profil kaydı → Qwen3-4B → cevap + profil güncellemesi.

### Bilimsel uyarı
Bu MVP'deki duygu/kişilik/üslup çıkarımı gerçek bir doğrulanmış model değildir; ilk prototipte sistem mimarisini test etmek için heuristik bir baseline'dır. TÜBİTAK deneyinde bunu ayrı modeller, etiketli veri ve ölçüm metrikleriyle değiştirmeliyiz. Sonuçlar deney yapılmadan rapora yazılmamalıdır.
