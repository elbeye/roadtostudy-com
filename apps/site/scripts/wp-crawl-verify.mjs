// Cutover crawl gate (§7.4): every URL in the SOURCE Rank Math sitemap must return
// 200 (or an expected 301) on the TARGET before DNS cutover. Any unexpected 404/5xx
// is a cutover blocker. Redirects covered by the intentional-redirect table
// (src/lib/redirects-data.mjs, served by src/middleware.ts) pass as
// "expected-redirect" when the Location matches the configured target; a wrong
// Location means the redirect layer is misconfigured and is a blocker. Redirects
// NOT covered by the table stay a "redirect" warning (reported, non-blocking).
// Read-only.
//
// Two modes:
//   --inventory                       Enumerate the source sitemap URL set only
//                                      (no target needed). Writes data/crawl-inventory.json.
//   (default)                         Inventory + check each URL against the target.
//                                      Writes data/crawl-report.json.
//
// Usage:
//   node scripts/wp-crawl-verify.mjs --inventory
//   WP_TARGET_BASE=https://roadtostudy-emdash-poc.murat-elbeye.workers.dev \
//     node scripts/wp-crawl-verify.mjs
//   WP_SOURCE_BASE=https://roadtostudy.com node scripts/wp-crawl-verify.mjs --json
import { mkdir, writeFile } from "node:fs/promises";

import { REDIRECTS, normalizePath } from "../src/lib/redirects-data.mjs";

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

// Map an observed status + Location header onto a verdict:
//   200                                          -> "ok"
//   3xx covered by a rule, Location matches `to` -> "expected-redirect" (passes the gate)
//   3xx covered by a rule, Location differs      -> "redirect-mismatch" (blocker: the
//                                                   redirect layer is misconfigured)
//   3xx not covered by any rule                  -> "redirect" (warning, non-blocking)
//   anything else                                -> "blocker"
// Rule paths and Location are compared trailing-slash-insensitively on the pathname
// (Location may be relative or absolute; it's resolved against the checked URL).
export function classifyResult(targetUrl, status, location, rules = REDIRECTS) {
	if (status === 200) return "ok";
	if (status !== 301 && status !== 308 && status !== 302 && status !== 307) return "blocker";
	const pathname = normalizePath(new URL(targetUrl).pathname);
	const rule = rules.find((r) => r.to && normalizePath(r.from) === pathname);
	if (!rule) return "redirect";
	const got = location ? normalizePath(new URL(location, targetUrl).pathname) : "";
	return got === normalizePath(rule.to) ? "expected-redirect" : "redirect-mismatch";
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

async function checkStatus(url) {
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
	// Dedupe (the homepage can appear once); keep first type seen.
	const seen = new Map();
	for (const e of entries) if (!seen.has(e.url)) seen.set(e.url, e.type);
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

	const results = await mapWithConcurrency(urls, CONCURRENCY, async ({ url, type }) => {
		const target = mapToTarget(url, SOURCE_BASE, TARGET_BASE);
		const { status, location, error } = await checkStatus(target);
		return { source: url, target, type, status, location, error, verdict: classifyResult(target, status, location) };
	});

	// A redirect-mismatch is a blocker too: the URL is covered by an intentional
	// rule but the layer sends it to the wrong place.
	const blockers = results.filter((r) => r.verdict === "blocker" || r.verdict === "redirect-mismatch");
	const redirects = results.filter((r) => r.verdict === "redirect");
	const report = {
		source: SOURCE_BASE,
		target: TARGET_BASE,
		total: results.length,
		ok: results.filter((r) => r.verdict === "ok").length,
		expectedRedirects: results.filter((r) => r.verdict === "expected-redirect").length,
		redirects: redirects.length,
		blockers: blockers.length,
		byType,
		blockerSample: blockers.slice(0, 50),
	};
	await writeFile(`${outDir}/crawl-report.json`, `${JSON.stringify({ ...report, results }, null, 2)}\n`);
	console.log(asJson ? JSON.stringify(report, null, 2) : renderReport(report, blockers));
	process.exitCode = blockers.length > 0 ? 1 : 0;
}

function renderInventory(s) {
	const types = Object.entries(s.byType)
		.map(([k, v]) => `  ${k}: ${v}`)
		.join("\n");
	return `Source: ${s.source}\nSub-sitemaps: ${s.subSitemaps}\nIndexed URLs: ${s.total}\n${types}`;
}

function renderReport(r, blockers) {
	const head = `Crawl parity: ${r.source} -> ${r.target}\n  total ${r.total} | 200 ${r.ok} | expected-301 ${r.expectedRedirects} | redirect ${r.redirects} | BLOCKERS ${r.blockers}`;
	if (!blockers.length) return `${head}\n  ✓ every source URL resolves (200/expected/redirect).`;
	const lines = blockers
		.slice(0, 20)
		.map((b) => `    [${b.verdict === "redirect-mismatch" ? `${b.status} -> ${b.location || "(no Location)"}` : b.status || b.error}] ${b.target}`);
	return `${head}\n  ✗ blockers (first 20):\n${lines.join("\n")}`;
}

// Only run when invoked directly, so tests can import the pure helpers.
if (process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("wp-crawl-verify.mjs")) {
	await main();
}
