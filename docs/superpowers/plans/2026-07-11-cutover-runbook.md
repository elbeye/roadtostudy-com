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
   - Kaynak sitemap'teki **2421 URL** hedefte 200/301 döner. Beklenmeyen 404/5xx = **cutover blocker** (script exit 1).
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
3. ~~Attachment page URL davranışı kararı (§10 açık) — kaynak crawl'ıyla tespit.~~ **Çözüldü** — bkz. aşağıdaki "Attachment page URL kararı" bölümü.

---

## Attachment page URL kararı (§10 açık → çözüldü, 2026-07-11)

Kaynak site canlı crawl + public REST (`wp/v2/media`, auth gerekmez) ile ölçüldü.

### Ampirik bulgular
| Bulgu | Değer |
|---|---|
| Sitemap'te attachment | **Yok** — 14 alt-sitemap yalnız post/page/category; attachment sitemap'i kapalı |
| Toplam attachment (media) | REST `X-WP-Total` 858; public olarak serialize edilen **853** (5'i public yanıt dışında → erişilebilir sayfası yok) |
| Ebeveynli attachment (695) | Pretty URL **301 → ebeveyn post permalink'i** (= URL'nin son segmenti atılmış hali) |
| Yetim attachment (158) | Pretty URL **301 → ana sayfa `/`** (locale-prefix'li olsa bile hedef kök `/`) |
| HTML attachment sayfası | Hiç servis edilmiyor — Rank Math "attachment redirect" açık, yanıt anında 301; dolayısıyla indexlenebilir attachment sayfası **yok** |

Canlıya karşı doğrulanan örnekler (redirect: manual):
- `/erasmus-degisim-vize-islemleri/visa-procedures-for-erasmus-exchange-students-3/` → 301 `/erasmus-degisim-vize-islemleri/`
- `/en/erasmus-opportunities-in-turkey/erasmus-scholarship-opportunities-for-international-students/` → 301 `/en/erasmus-opportunities-in-turkey/`
- `/artvin-coruh-universitesi-tanitim/artvin-coruh-universitesi-tanitim-2/` → 301 `/artvin-coruh-universitesi-tanitim/`
- `/kare-logo/kare-logo-2/` → 301 `/kare-logo/` (ebeveyn sitemap dışı olsa da kural aynı)
- Yetimler: `/15800/`, `/how-do-turks-celebrate-the-new-year/`, `/en/ozyegin-university-of-architecture/`, `/en/visa-procedures-for-erasmus-exchange-students-2/` → hepsi 301 `https://roadtostudy.com/`

### Karar
Davranış deterministik → **birebir replike edildi**: 853 attachment URL'sinin tamamı `apps/site/src/lib/redirects-data.mjs` içindeki `REDIRECTS` tablosuna 301 kuralı olarak eklendi (ebeveynli → ebeveyn path'i, yetim → `/`). Mevcut middleware (`src/middleware.ts`) bu tabloyu zaten uyguladığı için **kod değişikliği gerekmedi**; `wp-crawl-verify` beklenen-301 sınıflandırması da aynı tablodan beslendiği için cutover kapısıyla otomatik uyumlu.

Güvenlik kontrolleri:
- 853 `from` path'i, sitemap'teki 2421 canlı içerik URL'sinin **hiçbiriyle çakışmıyor** (WP slug'ları post tipleri arasında tekilleştirdiği için beklenen sonuç; ölçülerek doğrulandı).
- Kurallar `from`'a göre sıralı ve üretilmiş (generated) — elle düzenleme yerine yeniden üret.

Kabul edilen boşluk: `/?attachment_id=<id>` query-string biçimi replike edilmedi (matcher pathname bazlı). Bu biçim WP'nin hiçbir zaman dışa yayınlamadığı dahili bir varyant; canlıda da wp-cron 302 gürültüsüne takılıyor. Yeni sitede `/` + query ana sayfayı 200 döndürür — kabul edilebilir.
