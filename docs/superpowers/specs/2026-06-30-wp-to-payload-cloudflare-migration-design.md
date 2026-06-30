# WordPress → Payload (Cloudflare Workers) Göç Tasarımı

**Tarih:** 2026-06-30
**Kaynak site:** roadtostudy.com (WordPress, Polylang, Rank Math)
**Hedef:** Payload 3 + Next.js, Cloudflare Workers (Paid $5) üzerinde tam site (CMS + halka açık web)

---

## 1. Amaç ve Kapsam

WordPress'te koşan roadtostudy.com'u, içeriği ve SEO değeri **birebir korunarak** Payload CMS'e
taşımak ve Cloudflare Workers üzerinde çalıştırmak.

**Birincil kural:** Geçmiş SEO ve index **bozulmayacak**. Hiçbir URL, meta veri, schema, hreflang,
sitemap, görsel veya redirect kaybolmayacak.

### Bu spec'in kapsamı (DAHİL)
- WordPress'ten tam veri çıkarımı (içerik + SEO + medya + taksonomi + redirect'ler).
- Payload veri modeli ve 4 dilli (TR/EN/FR/ID) localization.
- Cloudflare Workers + D1 + R2 mimarisinin kurulumu.
- Halka açık siteyi render eden **minimal/fonksiyonel** Next.js frontend.
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

**Açık doğrulama maddesi:** Çıkarım sırasında `/wp-json/wp/v2/types` ve `/taxonomies` sorgulanarak
post/page dışında **custom post type / taksonomi olmadığı** kesinleştirilecek (geride içerik kalmaması için).

---

## 3. Hedef Mimari

```
Cloudflare Workers (Paid $5)
├── Payload 3 + Next.js  (OpenNext/Cloudflare adapter)
│   ├── /admin              → Yönetim paneli
│   ├── /{lang}/{slug}/     → Yazı & sayfa (SSR/ISR, trailing slash korunur)
│   ├── /{lang}/category/…  → Kategori arşivleri (indexli)
│   ├── /sitemap_index.xml  → Rank Math ile aynı yapıda
│   ├── /robots.txt
│   └── /wp-content/uploads/… → Workers route ile R2'den (görsel URL'leri DEĞİŞMEZ)
├── D1 (SQLite)             → @payloadcms/db-d1-sqlite (içerik + SEO meta)
└── R2                      → Medya (görseller, orijinal yol korunur)
```

**Geliştirme/test ortamı:** Önce geçici `*.workers.dev` subdomain'inde geliştirilip doğrulanır;
§6 listesi geçtikten sonra gerçek domain'e (DNS) geçilir.

- Temel: resmi **`with-cloudflare-d1`** Payload template'i.
- Bilinen risk: büyük şemalarda D1 "too many SQL variables" (Issue #14766) → kayıtlar parça parça
  (batch) yazılarak ve şema sade tutularak aşılır.
- Free plan **yetersiz** (bundle boyutu) → Paid Workers ($5) kullanılacak.

---

## 4. Veri Modeli (Payload Collections)

Tüm metin alanları **localized** (TR/EN/FR/ID). Çeviri grupları korunur.

- **posts** — title, slug, content (richText/HTML), excerpt, status (published/draft), publishedAt,
  modifiedAt, author (ilişki), categories (ilişki), featuredImage (ilişki), `seo` (group, §5), `schema` (§5).
- **pages** — title, slug, content, status, publishedAt, `seo`, `schema`.
- **categories** — name, slug, description, `seo` (arşiv indexli olduğu için).
- **media** — R2 backed; filename, alt, title, caption, mimetype, boyutlar.
- **users / authors** — yazar adı ve meta.
- **redirects** — from, to, type (301/302) — Rank Math redirect modülünden taşınan + slug değişimleri.
- **globals/settings** — site adı, ayraç, Organization schema, sosyal profiller, default OG image.

### Çeviri bağları
Polylang `translations` haritası (ör. `{tr, en, fr, id}` ID grupları) Payload localization'a map'lenir;
hreflang üretimi bu gruplara dayanır.

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
5. **hreflang + x-default** — 4 dil alternate etiketleri çeviri gruplarından üretilir.
6. **Sitemap** — Rank Math ile aynı yapı (`sitemap_index.xml` → post/page/category) + `lastmod`;
   GSC'ye submit edilir.
7. **robots.txt** — eşdeğer kurallar.
8. **Görsel URL stratejisi (KARARLAŞTI)** — Görseller **aynı domainde, eski `/wp-content/uploads/...`
   yolundan** sunulur (Workers route → R2). Böylece görsel URL'leri **hiç değişmez**; Google Images ve
   og:image birebir korunur, 301'e gerek kalmaz. alt/title/caption korunur.
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

### 7.2 Dönüştürme (Transform)
- Gutenberg HTML normalize edilir; dış kaynaktan kalma çöp `<div>`/markdown kalıntıları temizlenir
  (anlamı/SEO içeriğini bozmadan; başlık `id` anchor'ları korunur).
- Alanlar Payload şemasına map'lenir; çeviri grupları kurulur; medya referansları yeniden bağlanır.
- 1579 future yazı → `draft`.

### 7.3 Yükleme (Load)
- Medya R2'ye yüklenir (yol korunarak).
- İçerik D1'e **batch** yazılır (SQL değişken limiti güvenli tutulur).
- Çeviri bağları ve ilişkiler (kategori/yazar/featured image) kurulur.

### 7.4 Doğrulama (Verify)
- Sayım eşleşmesi (publish/draft/page/category sayıları kaynak = hedef).
- §6 listesinin spot kontrolleri (URL, meta, hreflang, schema, görsel, sitemap).
- Otomatik URL diff: kaynak sitemap URL'leri vs hedef yönlendirme tablosu.

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
| Payload+Workers bleeding-edge | Resmi `with-cloudflare-d1` template; Paid plan; erken PoC |
| D1 "too many SQL variables" | Batch insert, sade şema |
| Görsel URL değişimi → Google Images kaybı | Aynı domain + `/wp-content/uploads/` yolu korunur (URL değişmez) |
| hreflang/çeviri bağı kopması | Polylang haritası birebir taşınır, otomatik doğrulama |
| Bundle boyut limiti | Frontend sade tutulur, gereksiz bağımlılık yok |
| Çöp HTML temizliği içeriği bozar | Temizlik kuralları whitelist; örnek diff incelemesi |

---

## 10. Açık Onay Bekleyen Tek Bağımlılık
- WordPress **application password** (REST API çıkarımı için) — kullanıcı sağlayacak.

---

## Sonraki Adım
Bu spec onaylanınca **writing-plans** ile detaylı, adım adım uygulama planı (PoC → çıkarım → dönüşüm →
yükleme → doğrulama → cutover) hazırlanacaktır.
