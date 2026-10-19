# InfinityFree Yayın Paketi

Bu klasör, InfinityFree üzerinde çalıştırılmak üzere hazırlanmış hafif bir statik tanıtım sayfasıdır.

## Neden ayrı?

Ana Dijital İkiz uygulaması Next.js + server-side API + Supabase + Hugging Face kullandığı için Vercel üzerinde çalışır. InfinityFree tarafı ise proje tanıtımı ve uygulamaya yönlendirme için statik landing page olarak kullanılır.

## Yükleme

1. InfinityFree hosting hesabında domain/subdomain oluştur.
2. File Manager'ı aç.
3. Alan adının htdocs klasörüne index.html dosyasını yükle.
4. Canlı Vercel dağıtımı ve Supabase bağlantısı doğrulanana kadar tanıtım sayfası yalnızca GitHub kaynak koduna yönlendirir; sahte veya yer tutucu bir uygulama adresi yayınlanmaz.
5. Dağıtım doğrulandıktan sonra gerçek üretim alan adını ekleyip HTTPS üzerinden bağlantıyı test et.

InfinityFree resmi sitesine göre dosyalar FTP veya online File Manager ile yüklenebilir. Güncel topluluk dokümantasyonunda site dosyalarının htdocs içine konması gerektiği ve HTML/PHP/JS dosyaları için 1 MB dosya limiti bulunduğu belirtiliyor; bu landing page bu sınırın altında tutulmuştur.

## GitHub Actions ile güvenli yükleme

Depoda `.github/workflows/infinityfree-deploy.yml` dosyası statik landing page'i yükler. Bu yükleme ana Next.js sohbet uygulamasını değil, yalnızca bu klasördeki tanıtım sayfasını yayınlar.

Otomatik yükleme için GitHub repository'sinde **Settings → Secrets and variables → Actions** altında şu değerleri tanımla:

- `INFINITYFREE_FTP_SERVER`: InfinityFree hesap panelindeki FTP hostname.
- `INFINITYFREE_FTP_USERNAME`: FTP kullanıcı adı.
- `INFINITYFREE_FTP_PASSWORD`: FTP parolası.

Workflow, parola ve kullanıcı bilgilerini kaynak koda yazmadan GitHub Secrets üzerinden kullanır ve artık şifrelenmiş explicit FTPS bağlantısını (**port 21**) ister; sertifika kontrolü açık tutulur. Sunucu adını InfinityFree panelinden doğrula. TLS sertifikası seçilen hostname ile eşleşmiyorsa sertifika kontrolünü kapatmak yerine doğru FTP hostname'ini kullan.

Secrets eksikse upload işi atlanır. Secret'lar kaydedildikten sonra **Actions → Deploy InfinityFree landing page → Run workflow** üzerinden çalıştırılabilir.
