// Cutover crawl gate (§7.4): every URL in the SOURCE Rank Math sitemap must return
// 200 (or an expected 301) on the TARGET before DNS cutover. Any unexpected 404/5xx
// is a cutover blocker. Read-only.
//
// Status alone is not enough: a category archive whose posts are linked to the wrong
// locale's term still returns 200 while rendering nothing. So archives are also
// checked for content (see parseArchiveCount) and the localized EN/FR/ID archives —
// which Rank Math's TR-only category sitemap omits — are crawled by default.
//
// Two modes:
//   --inventory                       Enumerate the source sitemap URL set only
//                                      (no target needed). Writes data/crawl-inventory.json.
//   (default)                         Inventory + check each URL against the target.
//                                      Writes data/crawl-report.json.
//
// Exit code is 1 when there is any blocker or any unexpectedly empty archive.
//
// Env:
//   WP_SOURCE_BASE       source origin (default https://roadtostudy.com)
//   WP_TARGET_BASE       target origin to check (required for the crawl mode)
//   WP_EXTRA_ARCHIVES    override the localized archive list; "none" to skip them
//   WP_EXPECTED_EMPTY    override the legitimately-empty archive allowlist; "none"
//                        to require every archive to render posts
//
// Usage:
//   node scripts/wp-crawl-verify.mjs --inventory
//   WP_TARGET_BASE=https://roadtostudy-emdash-poc.murat-elbeye.workers.dev \
//     node scripts/wp-crawl-verify.mjs
//   WP_SOURCE_BASE=https://roadtostudy.com node scripts/wp-crawl-verify.mjs --json
import { mkdir, writeFile } from "node:fs/promises";

const XML_ENTITIES = [
	[/&amp;/g, "&"],
	[/&lt;/g, "<"],
	[/&gt;/g, ">"],
	[/&quot;/g, '"'],
	[/&apos;/g, "'"],
];

export function decodeXml(value) {
	let out = value;
	for (const [re, rep] of XML_ENTITIES) out = out.replace(re, rep);
	return out;
}

// Extract every <loc> value from a sitemap or sitemap index document.
export function parseLocs(xml) {
	return [...String(xml || "").matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map((m) => decodeXml(m[1].trim()));
}

// Classify a sub-sitemap URL into a content type for reporting.
export function sitemapType(url) {
	if (url.includes("post-sitemap")) return "post";
	if (url.includes("page-sitemap")) return "page";
	if (url.includes("category-sitemap")) return "category";
	return "other";
}

// Rewrite a source URL onto the target origin, preserving path/query (the migration
// keeps the exact path scheme, so parity means the same path resolves on the target).
export function mapToTarget(sourceUrl, sourceBase, targetBase) {
	const path = sourceUrl.startsWith(sourceBase) ? sourceUrl.slice(sourceBase.length) : new URL(sourceUrl).pathname;
	return `${targetBase.replace(/\/$/, "")}${path.startsWith("/") ? "" : "/"}${path}`;
}

const SOURCE_BASE = (process.env.WP_SOURCE_BASE || "https://roadtostudy.com").replace(/\/$/, "");
const TARGET_BASE = (process.env.WP_TARGET_BASE || "").replace(/\/$/, "");
const CONCURRENCY = Math.max(1, Number(process.env.WP_CRAWL_CONCURRENCY || 10));
const TIMEOUT_MS = Math.max(1000, Number(process.env.WP_CRAWL_TIMEOUT_MS || 15000));

async function fetchText(url) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
	try {
		const res = await fetch(url, { signal: controller.signal, redirect: "follow" });
		return res.ok ? await res.text() : "";
	} finally {
		clearTimeout(timer);
	}
}

async function checkStatusOnce(url) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
	try {
		// manual redirect so a 301/302 is recorded, not silently followed.
		let res = await fetch(url, { method: "HEAD", signal: controller.signal, redirect: "manual" });
		if (res.status === 405 || res.status === 501) {
			res = await fetch(url, { method: "GET", signal: controller.signal, redirect: "manual" });
		}
		return { status: res.status, location: res.headers.get("location") || undefined };
	} catch (err) {
		return { status: 0, error: String(err?.message || err) };
	} finally {
		clearTimeout(timer);
	}
}

// A crawl of thousands of URLs at high concurrency reliably produces a handful of
// client-side aborts ("operation was aborted", "fetch failed") that have nothing to
// do with the target — reporting those as cutover blockers trains everyone to ignore
// the gate. Only status 0 (no HTTP response at all) is retried; a real 404/5xx is
// returned on the first attempt and never masked by a retry.
async function checkStatus(url, attempts = 3) {
	let last;
	for (let i = 0; i < attempts; i++) {
		last = await checkStatusOnce(url);
		// Report how many attempts it took: a URL that only answers on retry is real
		// signal about target flakiness, and silently swallowing that would trade one
		// blind spot for another.
		if (last.status !== 0) return { ...last, attempts: i + 1 };
		if (i < attempts - 1) await sleep(250 * (i + 1));
	}
	return { ...last, attempts };
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// The localized (EN/FR/ID) category archives, absent from Rank Math's TR-only category
// sitemap. Verified against D1 on 2026-07-28: 10 terms per locale, translations of the
// 10 TR terms. WP_EXTRA_ARCHIVES (comma-separated paths) replaces this list when the
// taxonomy changes; keep it in sync if a category is added or renamed.
const DEFAULT_LOCALIZED_ARCHIVES = [
	"/en/category/academic-support-and-success/",
	"/en/category/career-and-internship/",
	"/en/category/cost-of-living-and-accommodation/",
	"/en/category/cultural-adaptation/",
	"/en/category/health-and-safety/",
	"/en/category/language-learning/",
	"/en/category/scholarships-and-funding/",
	"/en/category/student-life-and-travel/",
	"/en/category/university-and-programs/",
	"/en/category/visa-and-immigration/",
	"/fr/category/adaptation-culturelle/",
	"/fr/category/apprentissage-des-langues/",
	"/fr/category/bourses-et-financement/",
	"/fr/category/carriere-et-stage/",
	"/fr/category/cout-de-la-vie-et-hebergement/",
	"/fr/category/sante-et-securite/",
	"/fr/category/soutien-et-reussite-academiques/",
	"/fr/category/universite-et-programmes/",
	"/fr/category/vie-etudiante-et-voyages/",
	"/fr/category/visa-et-immigration/",
	"/id/category/adaptasi-budaya/",
	"/id/category/beasiswa-dan-pendanaan/",
	"/id/category/biaya-hidup-dan-akomodasi/",
	"/id/category/dukungan-dan-kesuksesan-akademik/",
	"/id/category/karier-dan-magang/",
	"/id/category/kehidupan-mahasiswa-dan-perjalanan/",
	"/id/category/kesehatan-dan-keamanan/",
	"/id/category/pembelajaran-bahasa/",
	"/id/category/universitas-dan-program/",
	"/id/category/visa-dan-imigrasi/",
];

export function localizedArchivePaths(raw = process.env.WP_EXTRA_ARCHIVES) {
	const list = parseListEnv(raw, DEFAULT_LOCALIZED_ARCHIVES);
	return list.map(normalizeArchivePath);
}

// An env var that is unset, empty, or whitespace means "use the built-in list"; the
// literal "none" (any casing) clears it. Anything else replaces it.
function parseListEnv(raw, fallback) {
	const value = String(raw ?? "").trim();
	if (!value) return fallback;
	if (value.toLowerCase() === "none") return [];
	return value.split(",").map((s) => s.trim()).filter(Boolean);
}

// Archives that are empty for a legitimate reason — every post in them is still
// `scheduled` (WordPress `future`), so nothing renders yet and the cron will fill
// them over time. Listed explicitly so a genuinely broken archive still fails the
// gate. Paths are locale-prefixed and trailing-slashed, matching the live URLs.
// Verified against D1 on 2026-07-28: en/academic-support-and-success 7 scheduled,
// en/language-learning 1, fr/bourses-et-financement 105, id/beasiswa-dan-pendanaan
// 105, id/visa-dan-imigrasi 96; en/career-and-internship has no EN post at all.
const DEFAULT_EXPECTED_EMPTY = [
	"/en/category/academic-support-and-success/",
	"/en/category/career-and-internship/",
	"/en/category/language-learning/",
	"/fr/category/bourses-et-financement/",
	"/id/category/beasiswa-dan-pendanaan/",
	"/id/category/visa-dan-imigrasi/",
];

// WP_EXPECTED_EMPTY overrides the built-in list (comma-separated paths); set it to
// "none" to require every archive to render posts.
export function expectedEmptySet(raw = process.env.WP_EXPECTED_EMPTY) {
	return new Set(parseListEnv(raw, DEFAULT_EXPECTED_EMPTY).map(normalizeArchivePath));
}

// The allowlist is written as site-relative paths, so strip the target base (which may
// carry a path prefix, e.g. a preview deployment served under /preview) before matching.
export function archiveKey(target, targetBase = "") {
	const base = String(targetBase || "").replace(/\/$/, "");
	const path = base && target.startsWith(base) ? target.slice(base.length) : target;
	return normalizeArchivePath(path);
}

export function normalizeArchivePath(value) {
	let path = String(value || "");
	if (/^https?:\/\//i.test(path)) {
		try {
			path = new URL(path).pathname;
		} catch {
			/* keep raw */
		}
	}
	if (!path.startsWith("/")) path = `/${path}`;
	return path.endsWith("/") ? path : `${path}/`;
}

// A category/tag archive that returns 200 but renders zero posts is invisible to the
// HEAD-only status check — exactly how the "every post linked to the EN term" migration
// bug shipped unnoticed. For archives we GET the body and read the rendered count.
// `null` means "count not found" (not an archive, or the markup changed) — never a blocker.
export function parseArchiveCount(html) {
	const m = String(html || "").match(/class="wp-excerpt"[^>]*>\s*(\d+)\s*posts?/i);
	return m ? Number(m[1]) : null;
}

async function fetchArchiveBodyOnce(url) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
	try {
		const res = await fetch(url, { signal: controller.signal, redirect: "manual" });
		if (res.status !== 200) return { failed: true };
		return { html: await res.text() };
	} catch {
		return { failed: true };
	} finally {
		clearTimeout(timer);
	}
}

// The body fetch needs the same retry as the status check: without it a transient
// abort yields "count unknown", the archive silently skips the content check, and the
// gate reports a green it did not earn — the exact degradation this check exists to
// prevent. A null count after all attempts is surfaced as unreadable, not as ok.
async function fetchArchiveCount(url, attempts = 3) {
	for (let i = 0; i < attempts; i++) {
		const { html, failed } = await fetchArchiveBodyOnce(url);
		if (!failed) return parseArchiveCount(html);
		if (i < attempts - 1) await sleep(250 * (i + 1));
	}
	return null;
}

async function mapWithConcurrency(items, limit, worker) {
	const out = new Array(items.length);
	let next = 0;
	async function run() {
		while (next < items.length) {
			const i = next++;
			out[i] = await worker(items[i], i);
		}
	}
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
	return out;
}

async function collectSourceUrls() {
	const indexXml = await fetchText(`${SOURCE_BASE}/sitemap_index.xml`);
	const subSitemaps = parseLocs(indexXml);
	const entries = [];
	for (const sub of subSitemaps) {
		const xml = await fetchText(sub);
		const type = sitemapType(sub);
		for (const loc of parseLocs(xml)) entries.push({ url: loc, type });
	}
	// Rank Math's category sitemap lists only the unprefixed TR archives, so crawling
	// the sitemap alone never touches the EN/FR/ID archives — the blind spot that let
	// 20 empty localized archives ship unnoticed. Localized slugs are translations, not
	// prefixed TR slugs, so they can't be derived; they're listed explicitly below and
	// included by default (an env-var-only opt-in would reopen the gap the moment
	// someone forgot to set it).
	const extra = localizedArchivePaths().map((p) => ({
		url: `${SOURCE_BASE}${p}`,
		type: "category",
	}));

	// Dedupe (the homepage can appear once); keep first type seen.
	const seen = new Map();
	for (const e of [...entries, ...extra]) if (!seen.has(e.url)) seen.set(e.url, e.type);
	return { subSitemaps, urls: [...seen].map(([url, type]) => ({ url, type })) };
}

function countByType(urls) {
	return urls.reduce((acc, u) => ((acc[u.type] = (acc[u.type] || 0) + 1), acc), {});
}

async function main() {
	const inventoryOnly = process.argv.includes("--inventory");
	const asJson = process.argv.includes("--json");
	const { subSitemaps, urls } = await collectSourceUrls();
	const byType = countByType(urls);
	const outDir = "data";
	await mkdir(outDir, { recursive: true });

	if (inventoryOnly || !TARGET_BASE) {
		await writeFile(
			`${outDir}/crawl-inventory.json`,
			`${JSON.stringify({ source: SOURCE_BASE, subSitemaps: subSitemaps.length, total: urls.length, byType, urls: urls.map((u) => u.url) }, null, 2)}\n`,
		);
		const summary = { mode: "inventory", source: SOURCE_BASE, subSitemaps: subSitemaps.length, total: urls.length, byType };
		console.log(asJson ? JSON.stringify(summary, null, 2) : renderInventory(summary));
		if (!TARGET_BASE && !inventoryOnly) {
			console.log("\nNo WP_TARGET_BASE set — inventory only. Set it to run the crawl check.");
		}
		return;
	}

	const expectedEmpty = expectedEmptySet();
	const results = await mapWithConcurrency(urls, CONCURRENCY, async ({ url, type }) => {
		const target = mapToTarget(url, SOURCE_BASE, TARGET_BASE);
		const { status, location, error, attempts } = await checkStatus(target);
		const ok = status === 200;
		const redirect = status === 301 || status === 308 || status === 302 || status === 307;
		let verdict = ok ? "ok" : redirect ? "redirect" : "blocker";
		// Content-level gate for archives: 200 with zero rendered posts fails, unless
		// the archive is a known scheduled-only one (see DEFAULT_EXPECTED_EMPTY).
		let postCount;
		if (ok && type === "category") {
			postCount = await fetchArchiveCount(target);
			if (postCount === 0) {
				verdict = expectedEmpty.has(archiveKey(target, TARGET_BASE)) ? "expected-empty" : "empty";
			}
		}
		return { source: url, target, type, status, location, error, attempts, postCount, verdict };
	});

	const blockers = results.filter((r) => r.verdict === "blocker");
	const empties = results.filter((r) => r.verdict === "empty");
	const redirects = results.filter((r) => r.verdict === "redirect");
	const retried = results.filter((r) => (r.attempts ?? 1) > 1);
	// An archive that answered 200 but whose count could not be parsed means the
	// content gate did not actually run. Silently counting those as "ok" is how the
	// empty-archive bug hid in the first place, so they are surfaced — and if NO
	// archive count could be read at all, the gate has degraded to a status-only
	// check and must fail rather than report a misleading green.
	const archives = results.filter((r) => r.type === "category" && r.status === 200);
	const unreadable = archives.filter((r) => r.postCount === null || r.postCount === undefined);
	const gateDegraded = archives.length > 0 && unreadable.length === archives.length;
	const report = {
		source: SOURCE_BASE,
		target: TARGET_BASE,
		total: results.length,
		ok: results.filter((r) => r.status === 200).length,
		redirects: redirects.length,
		blockers: blockers.length,
		empties: empties.length,
		expectedEmpty: results.filter((r) => r.verdict === "expected-empty").length,
		archivesChecked: archives.length,
		archivesUnreadable: unreadable.length,
		gateDegraded,
		retried: retried.length,
		byType,
		blockerSample: blockers.slice(0, 50),
		emptySample: empties.slice(0, 50),
		unreadableSample: unreadable.slice(0, 50).map((r) => r.target),
		retriedSample: retried.slice(0, 50).map((r) => ({ target: r.target, attempts: r.attempts })),
	};
	await writeFile(`${outDir}/crawl-report.json`, `${JSON.stringify({ ...report, results }, null, 2)}\n`);
	console.log(asJson ? JSON.stringify(report, null, 2) : renderReport(report, blockers, empties));
	process.exitCode = blockers.length + empties.length > 0 || gateDegraded ? 1 : 0;
}

function renderInventory(s) {
	const types = Object.entries(s.byType)
		.map(([k, v]) => `  ${k}: ${v}`)
		.join("\n");
	return `Source: ${s.source}\nSub-sitemaps: ${s.subSitemaps}\nIndexed URLs: ${s.total}\n${types}`;
}

function renderReport(r, blockers, empties = []) {
	const head = `Crawl parity: ${r.source} -> ${r.target}\n  total ${r.total} | 200 ${r.ok} | redirect ${r.redirects} | BLOCKERS ${r.blockers} | EMPTY ARCHIVES ${r.empties ?? 0} | expected-empty ${r.expectedEmpty ?? 0}`;
	const sections = [];
	if (blockers.length) {
		sections.push(`  ✗ blockers (first 20):\n${blockers.slice(0, 20).map((b) => `    [${b.status || b.error}] ${b.target}`).join("\n")}`);
	}
	if (empties.length) {
		sections.push(`  ✗ archives returning 200 with zero posts (first 20):\n${empties.slice(0, 20).map((b) => `    [empty] ${b.target}`).join("\n")}`);
	}
	if (r.gateDegraded) {
		sections.push(
			`  ✗ CONTENT GATE DEGRADED: no post count could be parsed on any of ${r.archivesChecked} archives —\n` +
				"    the archive markup likely changed; update parseArchiveCount before trusting this run.",
		);
	} else if (r.archivesUnreadable) {
		sections.push(`  ⚠ ${r.archivesUnreadable}/${r.archivesChecked} archives returned 200 but no post count could be read:\n${(r.unreadableSample || []).slice(0, 10).map((t) => `    [unreadable] ${t}`).join("\n")}`);
	}
	if (r.retried) {
		sections.push(`  ⚠ ${r.retried} URL(s) only answered after a retry (target flakiness, not a blocker):\n${(r.retriedSample || []).slice(0, 10).map((x) => `    [${x.attempts} attempts] ${x.target}`).join("\n")}`);
	}
	const clean = !blockers.length && !empties.length && !r.gateDegraded;
	if (clean && !sections.length) return `${head}\n  ✓ every source URL resolves (200/redirect) and no archive is empty.`;
	if (clean) return `${head}\n  ✓ every source URL resolves (200/redirect) and no archive is empty.\n${sections.join("\n")}`;
	return `${head}\n${sections.join("\n")}`;
}

// Only run when invoked directly, so tests can import the pure helpers.
if (process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("wp-crawl-verify.mjs")) {
	await main();
}
