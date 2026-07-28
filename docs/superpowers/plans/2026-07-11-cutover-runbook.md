# RoadToStudy — Canlıya Geçiş (Cutover) Yol Haritası

**Tarih:** 2026-07-11
**Kaynak:** roadtostudy.com (WordPress · Polylang · Rank Math)
**Hedef:** EmDash + Astro · Cloudflare Workers/D1/R2
**Referans:** `docs/superpowers/specs/2026-06-30-wp-to-payload-cloudflare-migration-design.md` (§6 kabul listesi, §7 hat, §8 cutover)

Bu belge, PoC'ten canlıya geçişin sıralı runbook'udur. Her adım bir **sahip etiketi**, **komut** ve **kabul kapısı** taşır.

> ## ✅ DURUM: CUTOVER TAMAMLANDI
> **Faz 1–5 bitti.** Site 2026-07-12'den beri canlı; DNS roadtostudy.com → Worker.
> İçerik prod D1'de (3766 post, 235 page, 40 kategori terimi), medya R2'de.
> Aşağıdaki faz adımları **tarihsel kayıt** olarak duruyor — yeniden koşulacak
> yönergeler değil. Cutover sonrası olay ve düzeltmeler için en alttaki
> **olay kaydı** bölümüne bak.
>
> | Ölçüm (2026-07-28 doğrulaması) | Değer |
> |---|---|
> | Post (toplam / yayında / zamanlanmış / draft) | 3766 / 2364 / 1384 / 18 |
> | Dil dağılımı (yayında) | TR 924 · EN 640 · FR 475 · ID 325 |
> | Page | 235 |
> | Kategori terimi | 40 (10 terim × 4 dil) |
> | Crawl kapısı | 2621 URL · 0 blocker · 0 beklenmeyen boş arşiv |
> | Medya | R2'den 200 (`/wp-content/uploads/...`) |

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

## Faz 1 — Tam içerik yükleme ✅ (tamamlandı)
**Amaç:** 2195 publish + 1553 future(→draft) + 18 draft post, 236 page, taksonomi + çeviri bağları prod D1'e.

1. **Çıkarım** (🔑 WP app password): `node --env-file=.env scripts/wp-export-full.mjs` → `data/wp-full.json`.
   - Kapı: `data/wp-full-summary.json` sayıları kaynakla eşleşir (post/page/kategori/locale dağılımı).
2. **Dönüştürme** (🟢): `npm run wp:seed:full` → `seed/seed.json` (full).
   - Açık iş: **migration-grade HTML→PortableText** (§7.2 — tablo/liste/anchor/FAQ). Gövde `content_html` ile verbatim render edildiği için görsel çıktı bundan etkilenmez; arama + okuma süresi + schema kalitesini iyileştirir. *(Repo içi, sıradaki kod işi.)*
3. **D1 SQL üretimi** (🟢): `npm run wp:d1:seed-sql` → `data/d1-update-sql/*` (batch, SQL değişken limiti güvenli).
4. **Yükleme** (🔑 Cloudflare): D1'e batch import; idempotent/resume.
   - Kapı: prod D1 sayıları = kaynak; `/posts`, birkaç `/{slug}/`, `/category/{slug}/` canlı 200.

## Faz 2 — Medya → R2 ✅ (tamamlandı)
`WP_SAMPLE_INPUT=data/wp-full.json npm run media:upload:full:confirmed` (idempotent, maliyet-korumalı; ~4496 R2 key).
- Kapı: upload seti HEAD 200; gövde/featured/OG'deki `/wp-content/uploads/...` hedefte 200 döner (§7.4 medya).

## Faz 3 — Redirect'ler ✅ (tamamlandı 2026-07-28)
1. ~~Rank Math Redirections'ı WP'den çıkar~~ **Bitti** — REST'te listeleme endpoint'i yok (yalnız `updateRedirection`), export wp-admin → Rank Math → Redirections'tan alındı: 24 aktif exact-match kural.
2. ~~Kuralları yaz~~ **Bitti** — tablo artık `src/lib/redirects-data.mjs` (düz veri, `wp-crawl-verify.mjs` ile paylaşılıyor), `src/lib/redirects.ts` yalnız tipli cephe. **877 exact kural** üç blok hâlinde: 853 üretilmiş attachment redirect'i (bkz. aşağıdaki "Attachment page URL kararı"), 24 Rank Math export kuralı (1 tanesi 410), 4 kategori slug alias'ı. Blok sırası anlamlı — lookup map son girdiyi tutar, yani export kuralı üretilmiş attachment varsayılanını ezer.
3. **Yapısal pattern'ler** (`redirects.ts` değil, aynı veri modülünde — böylece kapı da görüyor): `/page/N/` ve `/{locale}/page/N/` → kendi dilinin ana sayfası, `/author/{slug}/` → ana sayfa, herhangi bir `…/feed/` → `/rss.xml`. `/page/N/` pattern'i path başına sabitli, çünkü `/category/{slug}/page/N/` **canlı** bir route.
   - Kapı: 877 kuralın hepsi güncel sitemap'e (2591 URL) karşı tarandı — **0 çakışma**, yani hiçbir kural canlı içeriği gölgelemiyor. Hedeflerin 660'ından 657'si canlıda çözülüyor; 2 ölü hedef düzeltildi, 1 zincir düzleştirildi. `src/lib/redirects.test.ts` bu invariantları sabitliyor.
   - Kurallar routing'den **önce** koştuğu için yeni kural eklerken veya korpus büyüdüğünde bu çakışma taramasını tekrarla.

## Faz 4 — Otomatik doğrulama (cutover kapısı) ✅ (yeşil, sürekli koşulabilir)
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

## Faz 5 — Cutover ✅ (DNS çevrildi 2026-07-12)
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
1. ~~Migration-grade HTML→PortableText (§7.2) + testler.~~ **Bitti.**
2. ~~`wp-crawl-verify` için beklenen-301 haritası.~~ **Bitti** — tablo kapsamındaki 3xx'ler Location'ı hedefle karşılaştırılıp "expected-redirect" sayılır; **yanlış Location blocker'dır** (`redirect-mismatch`). Kural destekli 410 geçer, açıklanamayan 410 blocker.
3. ~~Attachment page URL davranışı kararı (§10 açık).~~ **Çözüldü** — bkz. aşağıdaki "Attachment page URL kararı".
4. ~~Zamanlanmış yayın paritesi.~~ **Bitti** — `scripts/wp-schedule-future.mjs`.

---

## Attachment page URL kararı (§10 açık → çözüldü)

Kaynak site canlı crawl'ı + public REST (`wp/v2/media`, auth gerekmez) ile ölçüldü.

**Bulgu:** Rank Math kaynak sitede her attachment sayfasını 301'liyordu — **parent'ı olan** attachment kendi parent permalink'ine (URL'in son segmenti düşer), **orphan** attachment ana sayfaya. Bu davranış, public olarak sayılabilen 853 attachment'ın tamamı için birebir kopyalandı ve canlı yanıtlara karşı örneklemle doğrulandı.

**Karar:** Attachment sayfaları hedefte **canlı route olarak üretilmiyor**; kaynağın 301'leri replike ediliyor. Böylece dış linkler ve eski indeks girdileri değer kaybetmiyor, ama migrasyona hiç içerik eklemiyor.

**Üretim notu:** Blok `from` alanına göre sıralı ve üretilmiş — elle düzenlemek yerine yeniden üret. İki elle müdahale bilinçli ve yorumda işaretli: bir zincir düzleştirildi (`/kare-logo/kare-logo-2/` parent'ı da orphan'dı) ve bir Rank Math hedefi migrasyonda var olmayan bir path'i gösterdiği için düzeltildi (404'e giden 301 değer taşımaz).

---

## Kapasite bulgusu (2026-07-11, cutover öncesi yük testi)

Eşzamanlı crawl'da isteklerin ~%4-6'sı **503 (Cloudflare error 1102 — Worker CPU/kaynak sınırı)** alıyordu; başarısız set koşudan koşuya değişiyor, hepsi solo istekte 200 dönüyordu. Örüntü (solo 200, eşzamanlıda 503, render ~400ms wall) **Workers Free'nin 10 ms CPU sınırıyla** tutarlıydı. Yük altında ana sayfa ~%20, `/posts` ~%90 503 veriyordu.

Bundan çıkan iki kalıcı sonuç:
- **`/posts` sınırsız render edilemez.** 2200+ postu tek istekte render etmek CPU sınırını aşıyor. Sayfa artık 24 kayıt + keyset sayfalama (`?cursor=`).
- **Cache API `*.workers.dev` üzerinde çalışmaz**, yani o günkü ölçümler **önbelleksiz en kötü durumdu**. Gerçek zone'a bağlandıktan sonra edge route cache devreye alınabilir hâle geldi — 2026-07-28'de açıldı (`astro.config.mjs` → `experimental.cache`). TTL bilinçli olarak kısa (maxAge 60s / swr 600s): tag-bazlı purge `CF_ZONE_ID` + `CF_CACHE_PURGE_TOKEN` secret'larını gerektiriyor, onlar tanımsızken bir sayfa yalnızca TTL ile tazelenebilir. 60 saniyede bu pratikte önemsiz ve tekrar render'ların neredeyse tamamı yine ortadan kalkıyor — kazanç TTL uzunluğundan değil hacimden geliyor. Secret'lar tanımlanırsa maxAge yükseltilebilir (ilk öneri 600/3600'dü), çünkü o zaman bayatlık düzenlemeyle sınırlı olur, saatle değil.

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

### Aynı gün, review sonrası ikinci tur (`eea7eaf`, `f4e3c10`)

Arşivlere dil değiştirici eklenmesi üç yeni sorun doğurdu; bağımsız review yakaladı, hepsi düzeltildi:

1. **hreflang kendi kümesinde değildi (30 URL).** `getTerm` locale fallback zincirini izlediği için TR slug'ı `/en/...` altında da 200 dönüyordu; sayfa, üyesi olmadığı bir küme ilan ediyordu. Artık catch-all bunları terimin kanonik arşivine **301** yapıyor — hem duplicate content bitti hem küme yapısal olarak self-referential oldu.
2. **`/page/N/` sayfaları page-1 hreflang'ı emit ediyordu.** Kardeş dillerin sayfa sayısı aynı olmak zorunda değil, o yüzden sayfalanmış arşivler artık hiç alternate emit etmiyor (self-canonical).
3. **Arşiv perf regresyonu.** `taxonomyAlternates` 4 locale için `getTaxonomyTerms` çağırıyor; her çağrı `content_taxonomies` üzerinde count aggregate koşuyor ve object cache (backend tanımlı olmadığı için) etkisiz. TTFB 4.2s'e çıkmıştı → slug haritası isolate başına memoize edildi, sıcak render post sayfalarıyla eşit (~1.0s).

Ayrıca: hiyerarşik taksonomide alt terimler düzleştirilerek kümeye dahil edildi; `fetchArchiveCount`'a retry eklendi (retry yoksa geçici hata içerik kontrolünü sessizce atlıyordu — kapının varlık sebebi olan hata modu); markup değişirse kapı `CONTENT GATE DEGRADED` ile **fail** ediyor; `seed/seed.json` takipten çıkarıldı ve `wp-runtime-seed.mjs` girdi yoksa atlıyor (temiz checkout'ta `npm run build` kırılıyordu).

### Aynı gün, UI düzeltmeleri (`6f1f430`)

Mobil görünüm gözden geçirildiğinde dört gerçek kusur bulundu:

| Kusur | Kök neden |
|---|---|
| Mobil header'da arama sağa yapışık ve placeholder kelime ortasından kesik; header 172px | `.nav-right` masaüstünün `margin-inline-start:auto`'sunu taşıyor ve grid kolonu içeriğe göre daralıyordu → çocukların `width:100%`'ü 200px'e göre çözülüyordu |
| Ana sayfada iki arama alanı | Header araması + `PortalHome` hero araması. `Base` artık `headerSearch` prop'u alıyor; ana sayfalar `false` geçiyor → mobil header 106px |
| Hero'daki "Ara" butonu etiket genişliğine sıkışmış | `padding: 0 var(--spacing-7)` — skala 6'dan 8'e atlıyor, tanımsız token tüm bildirimi geçersiz kılıyor. `src` altındaki tüm `var(--spacing-N)` kullanımları tarandı; tanımsız olan tek token buydu |
| Header/footer Türkçesi ASCII'ye indirgenmişti ("universite", "Tum yazilar", "Kesfet") | Hero doğru aksanlıydı, chrome değildi — Türk okuyucu kitlesi için tutarsız |

Doğrulama: 375px ve 1280px'te canlı ekran görüntüsü.

### Bu olaydan çıkan kalıcı kurallar
`apps/site/AGENTS.md` → **Rules › Learned the hard way** bölümüne yazıldı (locale-eşleşmeli taksonomi bağı, "200 ≠ çalışıyor", arşivin tek dilde kanonik olması, hreflang self-reference, `getTaxonomyTerms` maliyeti, spacing skalası). Gelecek oturumlar orayı okuyor.
