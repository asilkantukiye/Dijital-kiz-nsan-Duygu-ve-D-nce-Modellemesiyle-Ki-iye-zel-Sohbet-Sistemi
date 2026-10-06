# InfinityFree Yayın Paketi

Bu klasör, InfinityFree üzerinde çalıştırılmak üzere hazırlanmış hafif bir statik tanıtım sayfasıdır.

## Neden ayrı?

Ana Dijital İkiz uygulaması Next.js + server-side API + Supabase + Hugging Face kullandığı için Vercel üzerinde çalışır. InfinityFree tarafı ise proje tanıtımı ve uygulamaya yönlendirme için statik landing page olarak kullanılır.

## Yükleme

1. InfinityFree hosting hesabında domain/subdomain oluştur.
2. File Manager'ı aç.
3. Alan adının htdocs klasörüne index.html dosyasını yükle.
4. Vercel uygulaması canlı olduktan sonra index.html içindeki YOUR-VERCEL-DOMAIN bölümünü gerçek Vercel alan adıyla değiştir.
5. HTTPS üzerinden sayfayı test et.

InfinityFree resmi sitesine göre dosyalar FTP veya online File Manager ile yüklenebilir. Güncel topluluk dokümantasyonunda site dosyalarının htdocs içine konması gerektiği ve HTML/PHP/JS dosyaları için 1 MB dosya limiti bulunduğu belirtiliyor; bu landing page bu sınırın altında tutulmuştur.