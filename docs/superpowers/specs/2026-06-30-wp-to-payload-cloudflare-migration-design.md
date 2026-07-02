# WordPress → EmDash/Astro (Cloudflare Workers) Göç Tasarımı

**Tarih:** 2026-06-30
**Kaynak site:** roadtostudy.com (WordPress, Polylang, Rank Math)
**Hedef:** EmDash CMS + Astro, Cloudflare Workers (Paid $5) üzerinde tam site (CMS + halka açık web)

---

## 1. Amaç ve Kapsam

WordPress'te koşan roadtostudy.com'u, içeriği ve SEO değeri **birebir korunarak** EmDash CMS'e
taşımak ve Cloudflare Workers üzerinde çalıştırmak.

**Birincil kural:** Geçmiş SEO ve index **bozulmayacak**. Hiçbir URL, meta veri, schema, hreflang,
sitemap, görsel veya redirect kaybolmayacak.

### Bu spec'in kapsamı (DAHİL)
- WordPress'ten tam veri çıkarımı (içerik + SEO + medya + taksonomi + redirect'ler).
- EmDash veri modeli ve 4 dilli (TR/EN/FR/ID) localization.
- Cloudflare Workers + D1 + R2 mimarisinin kurulumu.
- Halka açık siteyi render eden **minimal/fonksiyonel** Astro frontend.
- Eksiksiz SEO/index koruma (bkz. §6).
- Göç, doğrulama ve cutover hattı.

### Kapsam DIŞI (sonraki aşamalar)
- Birebir tema/tasarım cilası (şimdilik minimal tema yeterli).
- Otomatik zamanlı yayın (cron). Gelecek tarihli yazılar **taslak** olarak gelir; yayın elle yapılır.
- Gelişmiş editör eklentileri, yorum sistemi, yeni özellikler.

---

## 2. Kaynak Durum Tespiti (doğrulanmış)

| Konu | Bulgu |
|---|---|
| Yazı (post) | 3766 toplam → **2169 publish + 1579 future + 18 draft** |
| Sayfa (page) | 236 |
| Diller | Polylang: **TR, EN, FR, ID** — çeviriler ID'lerle birbirine bağlı |
| URL yapısı | `https://roadtostudy.com/{lang}/{slug}/` — **trailing slash var** (canonical ile doğrulandı) |
| SEO | Rank Math: title, description, focus keyword, robots[index,follow], canonical, OG, Twitter |
| Schema | Varsayılan **BlogPosting**; içerikte FAQ blokları mevcut |
| Sitemap | Rank Math `sitemap_index.xml` → post (9) + page (2) + **category (1)**; tag/author yok |
| İçerik formatı | Gutenberg blok HTML'i; bazı yazılarda dış kaynaktan (ChatGPT/DeepSeek) kalma çöp `<div>` parçaları |
| GSC | `https://roadtostudy.com/` **tam yetkiyle** bağlı → göç sonrası doğrulama mümkün |

**Açık doğrulama maddeleri:**
- Çıkarım sırasında `/wp-json/wp/v2/types` ve `/taxonomies` sorgulanarak post/page dışında
  **custom post type / taksonomi olmadığı** kesinleştirilecek (geride içerik kalmaması için).
- Rank Math, Polylang ve redirect verilerinin REST API'den eksiksiz gelip gelmediği doğrulanacak.
  REST eksik kalırsa WP-CLI veya DB export fallback'i kullanılacak.
- WordPress attachment page URL'leri ve varsa attachment redirect davranışı crawl ile tespit edilecek.

---

## 3. Hedef Mimari

```
Cloudflare Workers (Paid $5)
├── EmDash CMS + Astro   (Cloudflare-native)
│   ├── /admin              → Yönetim paneli
│   ├── /{lang}/{slug}/     → Yazı & sayfa (SSR/ISR, trailing slash korunur)
│   ├── /{lang}/category/…  → Kategori arşivleri (indexli)
│   ├── /sitemap_index.xml  → Rank Math ile aynı yapıda
│   ├── /robots.txt
│   └── /wp-content/uploads/… → Workers route ile R2'den (görsel URL'leri DEĞİŞMEZ)
├── D1 (SQLite)             → EmDash içerik + SEO meta
└── R2                      → Medya (görseller, orijinal yol korunur)
```

**Geliştirme/test ortamı:** Önce geçici `*.workers.dev` subdomain'inde geliştirilip doğrulanır;
§6 listesi geçtikten sonra gerçek domain'e (DNS) geçilir.

- Temel: EmDash blog template + Cloudflare Workers/D1/R2 deployment.
- Bilinen risk: büyük şemalarda D1 "too many SQL variables" (Issue #14766) → kayıtlar parça parça
  (batch) yazılarak ve şema sade tutularak aşılır.
- Free plan **yetersiz** (bundle boyutu) → Paid Workers ($5) kullanılacak.

### 3.1 Teknoloji kararı

**Birincil karar:** EmDash + Astro + Cloudflare D1/R2/Workers.

Bu proje içerik ve SEO ağırlıklı bir WordPress göçü olduğu için EmDash/Astro hattı Payload/Next hattından daha
doğrudan uyuyor:

- EmDash Cloudflare-native çalışır; D1, R2 ve Workers varsayılan mimari parçasıdır.
- EmDash'in WordPress import akışı vardır; bu, özel migration kodu miktarını azaltabilir.
- Astro public site tarafında içerik odaklı, düşük JavaScript'li ve SEO-friendly bir yapı verir.
- RoadToStudy için esas ihtiyaç ağır app-builder değil; hızlı, güvenilir, yönetilebilir içerik yayınıdır.

**Fallback karar:** EmDash PoC veya yük testi SEO/import/i18n kabul kriterlerini karşılamazsa Payload 3 +
Next.js + Cloudflare D1/R2 planına geri dönülür.

**PoC baseline sürümleri:** EmDash Cloudflare template'i son kurulumda Astro 7/Vite 8 ile production build'de
Rolldown/WebAssembly memory hatası verdi. Bu nedenle PoC baseline `emdash@0.24.1`,
`@emdash-cms/cloudflare@0.24.1`, `astro@6.4.8`, `@astrojs/cloudflare@13.7.0` ve `vite@7.3.6`
override olarak sabitlendi. Bu baseline build/typecheck/load-smoke geçmeden yükseltme yapılmaz.

### 3.2 PoC ve yük testi kabul kriterleri

Cloudflare/D1 mimarisi tam göçe geçmeden önce küçük ama temsil gücü yüksek bir PoC ile doğrulanır.
PoC geçmeden migration script'leri genişletilmez.

- EmDash admin paneli Workers üzerinde açılır, login olur ve post/page/media CRUD çalışır.
- En az 50 post, 20 page, 20 media, 4 dil ve ilişki verileri D1'e yüklenir.
- Public route'lar (`/{lang}/{slug}/`, kategori arşivi, sitemap, robots, medya route'u) geçici domainde çalışır.
- Migration batch boyutu D1 SQL variable limitine takılmadan tekrar çalıştırılabilir (idempotent/resume).
- Admin listeleme ve public sayfa render süreleri kabul edilebilir düzeydedir; kabul dışı performans görülürse
  Payload fallback'i veya alternatif DB stratejisi ayrıca değerlendirilir.
- Yük testinde public sayfalar, kategori arşivleri, sitemap, medya route'u ve admin listeleme ayrı ayrı ölçülür.
- PoC, SEO diff'te URL/meta/canonical/hreflang/schema/OG/Twitter alanlarında kabul dışı fark üretmez.

### 3.3 Workers PoC durumu

2026-07-01 itibarıyla Cloudflare Workers üzerinde D1 + KV + R2 bağlı smoke deploy geçti:

- Worker URL: `https://roadtostudy-emdash-poc.murat-elbeye.workers.dev`
- D1: `roadtostudy-emdash-poc`
- KV session namespace: `roadtostudy-emdash-poc-session`
- R2 media bucket: `roadtostudy-emdash-media-poc`
- Current Version ID: `1ae92bec-7e67-41e3-a100-679729418e0c`
- WordPress sample export: 40 post, 21 page, 20 media, 40 category, 3 user, 20 SEO head snapshot.
- RoadToStudy sample seed validate edildi, canlıya deploy edildi ve D1'e import edildi:
  40 post, 20 page, 0 media, 50 kategori ilişkisi.
- Locale doğrulaması: postlar `en=10`, `fr=9`, `id=10`, `tr=11`; sayfalar `en=10`, `tr=10`.
- Translation-group doğrulaması: postlar 10 çeviri grubu, sayfalar 10 çeviri grubu; import edilen tüm
  post/page satırlarında `translation_group` dolu.
- Taxonomy locale doğrulaması: `category` taxonomy `en/fr/id/tr` için ayrı tanımlandı; 40 term
  (`en=10`, `fr=10`, `id=10`, `tr=10`) ve 50 post-kategori ilişkisi D1'de doğrulandı.
- Eski WordPress public URL şeması canlı smoke'tan geçti:
  - TR default: `/{slug}/`
  - EN/FR/ID: `/{locale}/{slug}/`
  - Kategori: `/category/{slug}/` ve `/{locale}/category/{slug}/`
  - İç linkler ve RSS linkleri `/posts/...` yerine WordPress uyumlu canonical path üretir.
- Canonical smoke: post/page/category örnekleri self-referential canonical üretir; `x-default`/hreflang
  üretimi içerik sayfalarında canlı smoke'tan geçti. `x-default` EN varyantına işaret eder; publish olmayan
  future/draft çeviriler alternate listesine eklenmez.
- Medya notu: 200 post + medya referansı içeren tek setup import'u Cloudflare Worker invocation API request
  limitine takıldı. Bu yüzden mevcut PoC seed'inde `WP_SEED_MEDIA_REFERENCES` varsayılan kapalıdır; medya
  final migration'da ayrı batch/R2 hattıyla taşınacak.
- Plugin sandbox / Worker Loader geçici olarak kapalı: hesapta Dynamic Workers için paid plan gerekli uyarısı
  (`code: 10195`) verdi. Mevcut migration PoC için plugin sandbox gerekmiyor.
- Workers load smoke: 15 sn, concurrency 10, 317 request, 0 fail, p95 1431.2 ms, p99 1718.7 ms.

Not: Bu smoke deploy D1 + KV session + R2 binding + sample content + public route + admin redirect
stabilitesini doğrular. Sıradaki PoC düzeltmeleri: Rank Math SEO meta/schema diff'i ve medya URL
(`/wp-content/uploads/...`) koruma route'u.

**Medya route/upload implemente edildi ve canlı doğrulandı (2026-07-02, bkz. §7.5):** serve tarafı
path=R2-key + Cache API; upload tarafı wrangler transport'u (mevcut `CLOUDFLARE_API_TOKEN` — ayrı S3
token'ı gerekmedi). Canlı worker'da (version `e6472897`) örnek setin 41 medyası R2'ye yüklendi ve doğrulandı;
`/wp-content/uploads/...` yolları 200 + `Cache-Control: public, max-age=31536000, immutable` + ETag döndürüyor,
eksik yollar 404. Bu, §3.3'teki açık medya maddesini kapatır. Not: featured görsellerin bir kısmı
`_embedded wp:featuredmedia`'dan geliyordu (media dizisinde değil); upload seti bunu kapsayacak şekilde
düzeltildi. Tam migration'da bekleyen: (a) binlerce dosya için wrangler-per-file yerine S3-API hızlı yolu
değerlendirmesi, (b) medya isteklerinin EmDash middleware'inden geçme maliyetinin ölçümü.

---

## 4. Veri Modeli (EmDash Collections)

Tüm metin alanları **localized** (TR/EN/FR/ID). Çeviri grupları korunur. Slug alanı da locale bazlı
tutulur; public URL üretimi her locale'in kendi slug'ını kullanır.

- **posts** — title, slug, content (richText/HTML), excerpt, status (published/draft), publishedAt,
  modifiedAt, originalStatus, originalScheduledAt, author (ilişki), categories (ilişki), featuredImage
  (ilişki), `seo` (group, §5), `schema` (§5).
- **pages** — title, slug, content, status, publishedAt, modifiedAt, `seo`, `schema`.
- **categories** — name, slug, description, `seo` (arşiv indexli olduğu için).
- **media** — R2 backed; filename, originalPath, alt, title, caption, mimetype, boyutlar.
- **users / authors** — yazar adı ve meta.
- **redirects** — from, to, type (301/302) — Rank Math redirect modülünden taşınan + slug değişimleri.
- **globals/settings** — site adı, ayraç, Organization schema, sosyal profiller, default OG image.

### Çeviri bağları
Polylang `translations` haritası (ör. `{tr, en, fr, id}` ID grupları) EmDash localization'a map'lenir;
hreflang üretimi bu gruplara dayanır.

### Routing ve çakışma kuralları

- Canonical public route formatı `/{lang}/{slug}/` olarak korunur.
- Aynı locale içinde page ve post slug çakışması varsa kaynak WordPress davranışı crawl ile doğrulanır ve
  hedefte birebir uygulanır.
- Router önceliği: statik sistem route'ları (`/admin`, `/sitemap_index.xml`, `/robots.txt`,
  `/wp-content/uploads/...`) → kategori arşivleri → page/post resolver.
- Çakışma raporu migration öncesi üretilir; otomatik slug değiştirme yapılmaz.

---

## 5. SEO Veri Modeli (alan bazında)

Her post/page için `seo` group:
- `metaTitle`, `metaDescription`
- `focusKeyword`
- `canonical` (varsayılan self-referential; kaynaktan farklıysa korunur)
- `robots` (index/noindex, follow/nofollow) — kaynaktaki diziden
- `ogTitle`, `ogDescription`, `ogImage`
- `twitterTitle`, `twitterDescription`

`schema` alanı:
- `type` (varsayılan `BlogPosting`)
- JSON-LD render: BlogPosting + BreadcrumbList; içerikte FAQ bölümü tespit edilirse FAQPage.
- Site geneli: Organization/WebSite schema (globals'tan).

---

## 6. SEO / Index Koruma Kontrol Listesi (açık kapı yok)

Bu liste göçün kabul kriteridir; her madde doğrulanmadan cutover yapılmaz.

1. **URL birebir korunur** — `/{lang}/{slug}/` + trailing slash; post, page, **kategori arşivi**,
   pagination (`/page/N/`).
2. **Mevcut redirect'ler taşınır** — Rank Math Redirections modülündeki tüm 301/302 kuralları çekilir.
3. **Meta birebir** — title/description/canonical/robots/OG/Twitter her içerikte.
4. **JSON-LD schema** — BlogPosting + Breadcrumb + Organization; FAQ blokları için FAQPage.
5. **hreflang + x-default** — 4 dil alternate etiketleri çeviri gruplarından üretilir; `x-default`
   uluslararası öğrenci hedefi nedeniyle EN varyantına işaret eder.
6. **Sitemap** — Rank Math ile aynı yapı (`sitemap_index.xml` → post/page/category) + `lastmod`;
   GSC'ye submit edilir.
7. **robots.txt** — eşdeğer kurallar.
8. **Görsel URL stratejisi (KARARLAŞTI)** — Görseller **aynı domainde, eski `/wp-content/uploads/...`
   yolundan** sunulur (Workers route → R2). Böylece görsel URL'leri **hiç değişmez**; Google Images ve
   og:image birebir korunur, 301'e gerek kalmaz. alt/title/caption korunur.
   Attachment page URL'leri ayrıca tespit edilir; indexli veya trafik alan attachment sayfaları varsa
   mevcut davranışa göre 301 ya da eşdeğer sayfa üretilir.
9. **Tarih korunur** — post_date / modified → publishedAt / modifiedAt (freshness + sitemap lastmod).
10. **İç link audit** — gövdedeki `roadtostudy.com` linkleri taranır; kırık/yanlış olanlar raporlanır.
11. **Hiçbir içerik geride kalmaz** — REST API tip/taksonomi keşfiyle doğrulanır.
12. **Cutover doğrulaması** — WP paralel açık; GSC ile coverage & 404 izlenir; index düşüşü gözlenir.

---

## 7. Göç Hattı (Migration Pipeline)

### 7.1 Çıkarım (Extract)
- **Yöntem:** WordPress REST API (`/wp-json/wp/v2/`) + **application password** (kullanıcı sağlayacak).
  Rank Math meta için MCP `rank-math/*` abilities yedek/tamamlayıcı.
- Çekilecekler: posts (tüm statüler), pages, categories, media, users, redirect kuralları, çeviri haritaları.
- Sayfalama (per_page=100) ile ~4000 kayıt; rate-limit'e dikkat, dirence dayanıklı (resume) script.
- REST API eksik veri döndürürse fallback sırası: WP-CLI export → doğrudan DB dump/okuma → eklentiye özel
  tablo/meta extraction. Hangi alanın hangi kaynaktan geldiği migration raporunda tutulur.

### 7.2 Dönüştürme (Transform)
- Gutenberg HTML normalize edilir; dış kaynaktan kalma çöp `<div>`/markdown kalıntıları temizlenir
  (anlamı/SEO içeriğini bozmadan; başlık `id` anchor'ları korunur).
- Alanlar EmDash şemasına map'lenir; çeviri grupları kurulur; medya referansları yeniden bağlanır.
- 1579 future yazı → `draft`; `originalStatus=future` ve `originalScheduledAt` saklanır.
- HTML temizliği whitelist tabanlıdır. Temizlenen her pattern için örnek input/output diff saklanır; anlamlı
  içerik, başlık anchor'ları, tablo/listeler, schema'ya kaynak olan FAQ içeriği ve iç linkler korunur.

### 7.3 Yükleme (Load)
- Medya R2'ye yüklenir (yol korunarak).
- İçerik D1'e **batch** yazılır (SQL değişken limiti güvenli tutulur).
- Çeviri bağları ve ilişkiler (kategori/yazar/featured image) kurulur.

### 7.4 Doğrulama (Verify)
- Sayım eşleşmesi (publish/draft/page/category sayıları kaynak = hedef).
- §6 listesinin spot kontrolleri (URL, meta, hreflang, schema, görsel, sitemap).
- Otomatik URL diff: kaynak sitemap URL'leri vs hedef yönlendirme tablosu.
- Otomatik HTML/meta diff: örneklem değil, tüm indexli post/page URL'lerinde title, description, canonical,
  robots, hreflang, OG/Twitter ve JSON-LD karşılaştırılır.
- Medya doğrulaması: gövdede, featured image'da ve OG image'da geçen `/wp-content/uploads/...` URL'leri
  hedefte 200 döner.
- Crawl doğrulaması: kaynak sitemap'teki tüm URL'ler hedefte 200/301 beklenen durumunu verir; beklenmeyen
  404/5xx cutover blocker'dır.

### 7.5 Medya route ve upload hattı (detay)

§6.8 "görsel URL'leri hiç değişmez" kararının somut uygulaması. Medya, **baytlar** ve **metadata**
olarak iki bağımsız hatta ayrılır — çünkü medyayı EmDash'in kendi yükleme API'sinden geçirmek (`$media`
fetch → Worker) 200-post import'unda Cloudflare Worker invocation limitine takılıyordu (bkz. §3.3).

**Serve route (public):**
- Astro API endpoint: `src/pages/wp-content/uploads/[...path].ts` (`prerender = false`). Dosya-tabanlı
  routing bu statik-prefix'li yolu `[...path].astro` catch-all'ından önce eşleştirir (§4 router önceliğiyle
  uyumlu; ekstra manuel routing yok).
- R2 binding'ine `context.locals.runtime.env.MEDIA` üzerinden erişilir — hem `astro dev` (Miniflare) hem de
  deploy edilmiş Workers'da aynı çalışır (`worker.ts` fetch-intercept yerine bu tercih edilir; aksi halde
  yerel geliştirme kırılır).
- **R2 anahtar şeması = orijinal WP yolu** (ör. `wp-content/uploads/2020/05/img.jpg`). Serve tarafında
  **D1 lookup yok** — tek bir R2 `get()`. Bu hem en hızlı hem de D1 free tier'ı hiç tüketmeyen yoldur.
- `GET`/`HEAD` dışına 405. Bulunursa: baytları stream et, `Content-Type` (R2 metadata; yoksa uzantı
  fallback map: jpg/png/webp/gif/svg/pdf), `Cache-Control: public, max-age=31536000, immutable`, `ETag`
  (R2 httpEtag) ve `If-None-Match` ile 304. Bulunamazsa düz 404 (HTML 404 sayfası değil; bu bir asset).
- Range/video şimdilik kapsam dışı (site görsel ağırlıklı; gerekirse ayrı iş).

**Maliyet katmanı (edge cache) — zorunlu:** URL aynı domainde kalmak zorunda olduğu için trafik mecburen
Worker'dan geçer (ayrı subdomain'de R2 public bucket URL'yi değiştirir, SEO'yu bozar). Bu nedenle route
içinde **Cache API (`caches.default`)** kullanılır: ilk istek → R2 `get()` → `cache.put()`; sonraki
istekler → `cache.match()` hit, **R2'ye gitmez**. `immutable` başlığıyla tarayıcı da cache'ler
(tekrar istek = 0 Worker + 0 R2). Sonuç: **R2 (10 GB storage / 10M read-ay / sınırsız ücretsiz egress) ve
D1 free tier'da kalır; Workers $5 planında (10M req/ay dahil) rahat çalışır.** Tüm medya 10 GB'ı aşarsa R2
storage ~$0.015/GB/ay (ör. 20 GB ≈ $0.15/ay, ihmal edilebilir); göç sırasında toplam boyut ölçülüp
raporlanır.

**Track A — Baytlar (Worker'ı kullanmadan R2'ye):**
- `scripts/wp-media-to-r2.mjs`: yerel Node, WP'den dosyayı indirir, **R2 S3-uyumlu API** ile doğrudan put
  eder (Worker'a değil). Anahtar = orijinal yol.
- Upload seti = üç kaynağın **birleşimi**: (a) WP media endpoint, (b) `featured_media`, (c) yazı
  gövdelerindeki `/wp-content/uploads/` taraması — gövdede referanslı ama library'de gözden kaçan görseller
  de dahil, hiçbiri 404 olmaz.
- **Idempotent/resume:** her dosya için önce R2 HEAD → varsa atla; kesinti sonrası kaldığı yerden devam.
  Paralel (concurrency limitli), rate-limit'e dayanıklı.
- Put = R2 Class A write (1M/ay free; birkaç bin dosya → sorun yok), tek seferlik.

**Track B — Metadata (mevcut batch import hattından D1'e):**
- `wp-sample-to-emdash-seed.mjs`: `$media` fetch yerine `featured_image = { src: "/wp-content/uploads/...",
  alt, title, caption }` — düz obje, Worker fetch yok. `<Image>` bu path'i basar → serve route'una düşer.
- Gövde HTML'i **değişmez** (path korunduğu için `<img src>`'ler zaten doğru).
- Bu ayrım sayesinde `WP_SEED_MEDIA_REFERENCES` bayrağı artık güvenle **açılabilir** (Worker limiti bypass).

**Doğrulama:** `wp-media-to-r2.mjs` sonunda upload setindeki tüm URL'ler için canlı Worker'a HEAD → 200
beklenir; 200 dönmeyenler rapor edilir (cutover blocker; §7.4 medya doğrulamasını besler).

---

## 8. Cutover Planı

1. Yeni site Cloudflare'de yayına alınır (geçici domain'de doğrulanır).
2. §6 kontrol listesi tamamen geçer.
3. DNS roadtostudy.com → Workers'a yönlendirilir; WP bir süre yedek/erişilebilir kalır.
4. GSC'de yeni sitemap submit + URL Inspection ile örnek indexleme kontrolü.
5. İlk 2–4 hafta GSC coverage, 404 ve sıralama izlenir; sapma olursa redirect/meta düzeltilir.

---

## 9. Riskler ve Önlemler

| Risk | Önlem |
|---|---|
| EmDash preview / genç ekosistem | PoC ve yük testi blocker; Payload fallback'i korunur |
| D1 limitleri / admin performansı | PoC/yük testi kabul kriterleri; batch insert; sade şema; gerekirse Payload veya alternatif DB kararı |
| Görsel URL değişimi → Google Images kaybı | Aynı domain + `/wp-content/uploads/` yolu korunur (URL değişmez) |
| hreflang/çeviri bağı kopması | Polylang haritası birebir taşınır, otomatik doğrulama |
| REST API eksik veri döndürür | WP-CLI / DB export fallback'i ve alan bazlı extraction raporu |
| Slug veya route çakışması | Migration öncesi çakışma raporu; WordPress davranışını birebir taklit |
| Bundle boyut limiti | Frontend sade tutulur, gereksiz bağımlılık yok |
| Çöp HTML temizliği içeriği bozar | Temizlik kuralları whitelist; örnek diff incelemesi |

---

## 10. Açık Kararlar ve Bağımlılıklar
- WordPress **application password** (REST API çıkarımı için) — kullanıcı sağlayacak.
- Attachment page URL'leri indexli/trafikli çıkarsa 301 mi üretilecek, yoksa eşdeğer attachment sayfası mı
  render edilecek?
- EmDash PoC/yük testi kabul dışı kalırsa Payload fallback veya alternatif DB için karar verilecek.

---

## Sonraki Adım
Bu spec onaylanınca **writing-plans** ile detaylı, adım adım uygulama planı (PoC → çıkarım → dönüşüm →
yükleme → doğrulama → cutover) hazırlanacaktır.
