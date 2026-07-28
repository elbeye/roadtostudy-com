# RoadToStudy — Canlıya Geçiş (Cutover) Yol Haritası

**Tarih:** 2026-07-11
**Kaynak:** roadtostudy.com (WordPress · Polylang · Rank Math)
**Hedef:** EmDash + Astro · Cloudflare Workers/D1/R2
**Referans:** `docs/superpowers/specs/2026-06-30-wp-to-payload-cloudflare-migration-design.md` (§6 kabul listesi, §7 hat, §8 cutover)

Bu belge, PoC'ten canlıya geçişin sıralı runbook'udur. Her adım bir **sahip etiketi**, **komut** ve **kabul kapısı** taşır.

## Sahip etiketleri
- 🟢 **Repo içi** — kod/araç hazır, kimlik bilgisi gerekmez; ben tamamlayıp doğrulayabilirim.
- 🔑 **Kimlik-bilgisi** — WP application password veya Cloudflare API token gerektirir (kullanıcı sağlar; spec §10). Araç hazır, sadece çalıştırma gizli anahtara bağlı.
- 🌐 **Harici** — DNS / Google Search Console; panel üzerinden insan işlemi.

---

## Canlı kaynaktan doğrulanmış gerçekler (2026-07-11)
Bu değerler canlı roadtostudy.com'a karşı ölçüldü; cutover kapılarının referansı bunlardır.

| Ölçüm | Değer |
|---|---|
| sitemap_index alt-sitemap sayısı | **14** (post ×11, page ×2, category ×1) |
| Toplam indexli URL (benzersiz) | **2421** (post 2176, page 235, category 10) |
| post-sitemap1 | **201 URL** = ana sayfa + 200 post (Rank Math davranışı — kodumuz birebir eşliyor) |
| Kategori arşivi (sitemap) | **10** — yalnız prefix'siz TR `/category/{slug}/`; EN/FR/ID kategori arşivi sitemap'te YOK |
| Arşiv pagination | `/category/{slug}/page/N/`, **sayfa başına 10 post** |
| URL şeması | TR `/{slug}/`, diğer diller `/{locale}/{slug}/` (trailing slash) |

> Not: Bu doğrulamalar sırasında iki hatalı varsayım düzeltildi — (a) post-sitemap1'in 201 olması bir bug değil, parite; (b) kategori sitemap'i 4 dili değil, yalnız 10 TR terimini içermeli.

---

## Faz 0 — Şu anki durum (bitti)
- 🟢 Public route mimarisi tek `[...path].astro`'da; post/page/kategori/tag + locale ana sayfaları + `/page/N/` pagination.
- 🟢 SEO paritesi: verbatim Rank Math head (`source_seo`), hreflang + x-default→EN, robots, canonical.
- 🟢 Sitemap yapısı Rank Math ile eşleşiyor; RSS; robots.txt.
- 🟢 Redirect mekanizması (`src/middleware.ts` + `src/lib/redirects.ts`) — boşken no-op.
- 🟢 Medya serve route'u (`/wp-content/uploads/...` → R2, Cache API, ETag/304).
- 🟢 Crawl doğrulama aracı (`scripts/wp-crawl-verify.mjs`) + SEO diff (`scripts/wp-seo-diff.mjs`).

---

## Faz 1 — Tam içerik yükleme 🔑
**Amaç:** 2195 publish + 1553 future(→draft) + 18 draft post, 236 page, taksonomi + çeviri bağları prod D1'e.

1. **Çıkarım** (🔑 WP app password): `node --env-file=.env scripts/wp-export-full.mjs` → `data/wp-full.json`.
   - Kapı: `data/wp-full-summary.json` sayıları kaynakla eşleşir (post/page/kategori/locale dağılımı).
2. **Dönüştürme** (🟢): `npm run wp:seed:full` → `seed/seed.json` (full).
   - Açık iş: **migration-grade HTML→PortableText** (§7.2 — tablo/liste/anchor/FAQ). Gövde `content_html` ile verbatim render edildiği için görsel çıktı bundan etkilenmez; arama + okuma süresi + schema kalitesini iyileştirir. *(Repo içi, sıradaki kod işi.)*
3. **D1 SQL üretimi** (🟢): `npm run wp:d1:seed-sql` → `data/d1-update-sql/*` (batch, SQL değişken limiti güvenli).
4. **Yükleme** (🔑 Cloudflare): D1'e batch import; idempotent/resume.
   - Kapı: prod D1 sayıları = kaynak; `/posts`, birkaç `/{slug}/`, `/category/{slug}/` canlı 200.

## Faz 2 — Medya → R2 🔑
`WP_SAMPLE_INPUT=data/wp-full.json npm run media:upload:full:confirmed` (idempotent, maliyet-korumalı; ~4496 R2 key).
- Kapı: upload seti HEAD 200; gövde/featured/OG'deki `/wp-content/uploads/...` hedefte 200 döner (§7.4 medya).

## Faz 3 — Redirect'ler 🔑
1. 🔑 Rank Math Redirections'ı WP'den çıkar (app password ile) → kurallar.
2. 🟢 Kuralları `src/lib/redirects.ts` içindeki `REDIRECTS` dizisine yaz (`{ from, to, status }`).
   - Kapı: örnek eski URL'ler middleware'de 301/302 döner; canlı URL'ler etkilenmez.

## Faz 4 — Otomatik doğrulama (cutover kapısı) 🟢/🔑
Hedef geçici domainde ayaktayken:
1. **Crawl parite** (🟢 araç, 🔑 hedef): `WP_TARGET_BASE=<worker-url> node scripts/wp-crawl-verify.mjs`
   - Kaynak sitemap'teki URL'ler hedefte 200/301 döner. Beklenmeyen 404/5xx = **cutover blocker** (script exit 1).
   - Ayrıca **içerik kapısı**: kategori arşivleri GET edilip render edilen yazı sayısı okunur. 200 dönüp 0 yazı gösteren arşiv = blocker. Yalnızca `DEFAULT_EXPECTED_EMPTY` listesindeki (tüm yazıları `scheduled` olan) arşivler muaf.
   - Rank Math kategori sitemap'i sadece prefix'siz TR arşivlerini içerdiği için EN/FR/ID arşivleri `DEFAULT_LOCALIZED_ARCHIVES` üzerinden **varsayılan olarak** taranır. Taksonomi değişirse bu listeyi güncelle.
   - Geçici ağ hataları (status 0) 3 denemeye kadar retry edilir; gerçek 404/5xx retry edilmez.
2. **SEO/meta parite** (🟢/🔑): `WP_TARGET_BASE=<worker-url> node scripts/wp-seo-diff.mjs`
   - title/description/canonical/robots/OG/Twitter/JSON-LD birebir; hreflang bilinçli olarak kaynağı aşar (x-default).
3. **Medya parite** (🔑): `media:upload:full` sonundaki HEAD doğrulaması 200.
4. **Yük testi** (🔑 hedef): `BASE_URL=<worker-url> npm run load:test` — public/kategori/sitemap/medya/admin p95/p99 kabul edilebilir.

## Faz 5 — Cutover 🌐
1. Faz 4 kapılarının hepsi yeşil.
2. 🌐 DNS roadtostudy.com → Workers; WP bir süre yedek kalır.
3. 🌐 Cloudflare Managed Content (AI-crawler blokları) yeni zone'da tekrar aç (bkz. `robots.txt.ts` notu).
4. 🌐 GSC: yeni sitemap submit + URL Inspection ile örneklem.
5. 🌐 İlk 2–4 hafta: GSC coverage / 404 / sıralama izle; sapmada redirect/meta düzelt.

---

## Kimlik-bilgisi / harici bağımlılık özeti
| Bağımlılık | Gereken adımlar | Kim sağlar |
|---|---|---|
| WP application password | Faz 1 çıkarım, Faz 3 redirect çıkarımı | Kullanıcı (§10) |
| Cloudflare API token | Faz 1 D1 yükleme, Faz 2 R2, Faz 4 hedef | Kullanıcı |
| DNS erişimi | Faz 5 | Kullanıcı |
| Google Search Console | Faz 5 izleme | Kullanıcı (GSC zaten bağlı, §2) |

## Sıradaki repo-içi işler (kimlik-bilgisi beklemeden yapılabilir) 🟢
1. Migration-grade HTML→PortableText (§7.2) + testler.
2. `wp-crawl-verify` için beklenen-301 haritası (bilinçli redirect'lerde 301'i "ok" say).
3. Attachment page URL davranışı kararı (§10 açık) — kaynak crawl'ıyla tespit.

---

## Cutover sonrası olay kaydı — 2026-07-28: boş kategori arşivleri

**Belirti:** `/fr/category/adaptation-culturelle/` (ve benzerleri) 200 dönüyor ama hiç yazı göstermiyordu.

**Kök neden:** Migration her postu, kendi dilindeki kategori terimi yerine **EN terimine** bağlamıştı. `translation_group` doğru kurulmuştu ama `content_taxonomies` bağları yanlış uçtaydı. Arşiv sorgusu aktif dilin terimini aradığı için TR/FR/ID'de 0 sonuç dönüyordu.

**Etki:** 40 kategori arşivinin **30'u boştu** — TR 10/10, FR 10/10, ID 10/10 (sitemap'teki 10 TR URL'i dahil). Görünmeyen yayında yazı: **1725**.

**Neden kapıdan geçti (iki kör nokta):**
1. Crawl gate yalnız HTTP kodunu ölçüyordu; boş sayfa da 200 = "ok" sayılıyordu.
2. Kategori sitemap'i sadece TR'yi içerdiği için EN/FR/ID arşivleri hiç taranmıyordu.

**Onarım:** `content_taxonomies.taxonomy_id`, `translation_group` üzerinden postun kendi dilindeki terime taşındı — **2824 satır**. Öncesinde yedek alındı (`data/content-taxonomies-backup.json`). Sonrası: hatalı bağ 0; TR 924 / FR 476 / ID 325 yayında yazı arşivlerde göründü. Kalan 6 boş arşiv meşru (yazıları `scheduled`, biri EN'de hiç yazı içermiyor).

**Kalıcı önlem:** Faz 4 crawl kapısına içerik doğrulaması + varsayılan locale arşiv taraması + retry eklendi (yukarı bkz.). Ek olarak kategori/tag arşivlerine dil değiştirici + hreflang eklendi (`taxonomyAlternates`).

**Ders:** "HTTP 200" içerik doğruluğu demek değil. Parite kapıları, kullanıcının gördüğü çıktıyı ölçmeli.
