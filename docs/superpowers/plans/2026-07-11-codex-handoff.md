# Codex Devir Listesi — RoadToStudy canlıya geçiş

**Bağlam:** Migration kodu bulut oturumunda tamamlandı ve doğrulandı (branch
`claude/project-understanding-review-l213qo`, 8 commit). Aşağıdaki adımlar **yerel `.env`
(WP application password) ve Cloudflare token** gerektirir — bulut sandbox'ında çalıştırılamaz,
bu yüzden **Codex bunları Mac'te koşar**. Tam gerekçe/kapılar: `docs/superpowers/plans/2026-07-11-cutover-runbook.md`.

**Çalışma dizini:** `apps/site` · Tüm komutlar oradan.

**Ön koşul — `apps/site/.env`:**
```
WP_USERNAME=...
WP_APPLICATION_PASSWORD=...
CLOUDFLARE_API_TOKEN=...
EMDASH_ENCRYPTION_KEY=...
```

---

## Sıralı görevler

### 1. Tam çıkarım (WP) 🔑
```
node --env-file=.env scripts/wp-export-full.mjs
```
→ `data/wp-full.json` (+ summary). **Kapı:** summary sayıları kaynakla eşleşir
(post publish/future/draft, page, category, locale dağılımı; §2/§7.1: ~3766 post, 236 page).

### 2. Tam seed üret 🟢
```
npm run wp:seed:full
```
→ `seed/seed.json`. **Kapı:** `contentHtmlEntries ≈ 4001`, `sourceSeoEntries ≈ 2430`,
malformed featured image = 0. (Not: içerik blokları artık migration-grade —
liste/başlık/blockquote/link korunuyor; bkz. `scripts/html-to-portable-text.mjs`.)

### 3. D1 SQL parçaları üret 🟢
```
npm run wp:d1:seed-sql
```
→ `data/d1-update-sql/*`. **Kapı:** parçalar SQL değişken limitini aşmaz, tekrar çalıştırılabilir.

### 4. Prod D1'e yükle 🔑 (wrangler + CF token)
Batch/idempotent import. **Kapı:** prod D1 sayıları = kaynak; birkaç `/{slug}/`,
`/{locale}/{slug}/`, `/category/{slug}/` canlı 200 döner.

### 5. Medya → R2 🔑
```
WP_SAMPLE_INPUT=data/wp-full.json npm run media:upload:full:confirmed
```
→ ~4496 R2 key (idempotent, maliyet-korumalı). **Kapı:** upload seti HEAD 200; gövde/featured/OG
içindeki `/wp-content/uploads/...` hedefte 200.

### 6. Rank Math redirect'leri 🔑
WP Redirections modülünü çıkar → kuralları `src/lib/redirects.ts` içindeki `REDIRECTS`
dizisine yaz (`{ from, to, status }`). **Kapı:** örnek eski URL middleware'de 301/302; canlı URL etkilenmez.

### 7. Doğrulama (hedef = geçici worker URL) 🟢 araç / 🔑 hedef
```
WP_TARGET_BASE=<worker-url> node scripts/wp-crawl-verify.mjs   # 2421 URL 200/301, 0 blocker (exit 0)
WP_TARGET_BASE=<worker-url> node scripts/wp-seo-diff.mjs        # meta/canonical/og/twitter/jsonld parite
BASE_URL=<worker-url> npm run load:test                        # p95/p99 kabul
```
**Kapı:** crawl-verify blocker = 0; seo-diff farkları yalnız bilinçli hreflang (x-default).

### 8. Cutover 🌐
DNS roadtostudy.com → Workers · Cloudflare Managed Content (AI-crawler blokları) yeni zone'da tekrar aç
(bkz. `src/pages/robots.txt.ts` notu) · GSC'ye sitemap submit + URL Inspection · 2–4 hafta coverage/404/sıralama izle.

---

## Küçük repo-içi işler (kimlik-bilgisi beklemez — Codex veya bulut yapabilir)
- **İç-link audit (§6.10):** kaynak gövdede **28 bozuk link** (`https://https://…`) tespit edildi;
  temizlik kuralı + rapor. Dönüştürücü bunları şu an sadakatle koruyor.
- **crawl-verify beklenen-301 haritası:** bilinçli redirect'lerde 301'i "ok" say (şu an redirect olarak raporlanıyor).
- **Attachment page URL kararı (§10 açık):** indexli/trafikli ise 301 mı, eşdeğer sayfa mı — kaynak crawl'ıyla tespit.

## Doğrulanmış parite gerçekleri (bulut oturumu, canlı kaynağa karşı)
- Toplam indexli URL: **2421** (post 2176 / page 235 / category 10), 14 alt-sitemap.
- post-sitemap1 = **201** (ana sayfa + 200 post) — Rank Math davranışı, kod eşliyor.
- category-sitemap = yalnız **10 TR** kategori (EN/FR/ID yok) — kod eşliyor.
- Pagination = **10 post/sayfa**, `/category/{slug}/page/N/` — kod eşliyor.

## Geri getirilecek çıktı
`data/crawl-report.json` (0 blocker), seo-diff sonucu, prod D1 sayıları.
