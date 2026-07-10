// SEO parity diff: compares each source WordPress (Rank Math) head snapshot against
// the head the target EmDash site renders for the same path. Evidence for spec §6.3-6
// ("meta birebir") and §7.4 (verify). Read-only; makes GET requests to the target.
//
// Usage:
//   node scripts/wp-seo-diff.mjs                          # diff against default worker
//   WP_TARGET_BASE=https://roadtostudy.com node scripts/wp-seo-diff.mjs
//   node scripts/wp-seo-diff.mjs --json                   # machine-readable report
import { readFile } from "node:fs/promises";

const inputPath = process.env.WP_SAMPLE_INPUT || "data/wp-sample.json";
const targetBase = (process.env.WP_TARGET_BASE || "https://roadtostudy-emdash-poc.murat-elbeye.workers.dev").replace(/\/$/, "");
const asJson = process.argv.includes("--json");
const concurrency = Math.max(1, Number(process.env.WP_SEO_DIFF_CONCURRENCY || 8));
const timeoutMs = Math.max(1000, Number(process.env.WP_SEO_DIFF_TIMEOUT_MS || 15000));

const source = JSON.parse(await readFile(inputPath, "utf8"));
const snapshots = (source.seo?.headSnapshots || []).filter((h) => h && h.status === 200 && h.url);

// --- head extraction (mirrors wp-export-sample.mjs pickHead) ---
function parseAttrs(tag) {
	const attrs = {};
	for (const match of tag.matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
		const [, key, dq, sq, bare] = match;
		if (!key || key === "meta" || key === "link" || key === "script") continue;
		attrs[key.toLowerCase()] = decodeEntities(dq ?? sq ?? bare ?? "");
	}
	return attrs;
}

function decodeEntities(v) {
	return String(v)
		.replaceAll("&amp;", "&")
		.replaceAll("&quot;", '"')
		.replaceAll("&#039;", "'")
		.replaceAll("&#39;", "'")
		.replaceAll("&#8217;", "’")
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">");
}

function extractHead(html) {
	const head = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i)?.[1] || html;
	const metas = [];
	const links = [];
	const jsonLd = [];
	for (const tag of head.matchAll(/<meta\b[^>]*>/gi)) metas.push(parseAttrs(tag[0]));
	for (const tag of head.matchAll(/<link\b[^>]*>/gi)) links.push(parseAttrs(tag[0]));
	for (const tag of head.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
		const raw = tag[1]?.trim();
		if (!raw) continue;
		try {
			jsonLd.push(JSON.parse(raw));
		} catch {
			jsonLd.push(raw);
		}
	}
	return {
		title: decodeEntities(head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || ""),
		canonical: links.find((l) => l.rel?.toLowerCase() === "canonical")?.href || null,
		hreflang: links
			.filter((l) => l.rel?.toLowerCase() === "alternate" && l.hreflang)
			.map((l) => ({ hreflang: l.hreflang, href: l.href })),
		meta: metas,
		jsonLd,
	};
}

// --- normalize a head into comparable SEO fields ---
function metaContent(head, key) {
	const hit = (head.meta || []).find((m) => m.name === key || m.property === key);
	return hit?.content ?? null;
}

function jsonLdTypes(head) {
	const types = new Set();
	for (const block of head.jsonLd || []) {
		if (typeof block !== "object" || !block) continue;
		const nodes = Array.isArray(block["@graph"]) ? block["@graph"] : [block];
		for (const n of nodes) {
			const t = n?.["@type"];
			if (Array.isArray(t)) t.forEach((x) => types.add(x));
			else if (t) types.add(t);
		}
	}
	return [...types].sort();
}

function seoFields(head) {
	return {
		title: head.title || null,
		description: metaContent(head, "description"),
		robots: metaContent(head, "robots"),
		canonicalPath: pathOf(head.canonical),
		ogTitle: metaContent(head, "og:title"),
		ogDescription: metaContent(head, "og:description"),
		ogImagePath: pathOf(metaContent(head, "og:image")),
		twitterTitle: metaContent(head, "twitter:title"),
		twitterDescription: metaContent(head, "twitter:description"),
		hreflang: (head.hreflang || []).map((h) => h.hreflang).sort(),
		jsonLdTypes: jsonLdTypes(head),
	};
}

// Compare host-independent: canonical/og:image hosts differ pre-cutover, so compare paths.
function pathOf(url) {
	if (!url) return null;
	try {
		return new URL(url).pathname;
	} catch {
		return url;
	}
}

const FIELDS = [
	"title",
	"description",
	"robots",
	"canonicalPath",
	"ogTitle",
	"ogDescription",
	"ogImagePath",
	"twitterTitle",
	"twitterDescription",
	"hreflang",
	"jsonLdTypes",
];

function eq(a, b) {
	if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => x === b[i]);
	return a === b;
}

const results = await mapLimit(snapshots, concurrency, async (snap) => {
	const path = pathOf(snap.url) || snap.url;
	const targetUrl = `${targetBase}${path}`;
	let targetHead = null;
	let error = null;
	try {
		const res = await fetch(targetUrl, {
			headers: { Accept: "text/html" },
			signal: AbortSignal.timeout(timeoutMs),
		});
		if (!res.ok) error = `target ${res.status}`;
		else {
			const html = await res.text();
			if (!/<(?:head|title|meta)\b/i.test(html)) error = `target ${res.status} non-html-or-empty`;
			else targetHead = extractHead(html);
		}
	} catch (e) {
		error = String(e);
	}

	// Source snapshot already has {title, canonical, hreflang, meta, jsonLd} in wp-export shape.
	const sourceFields = seoFields(snap);
	const targetFields = targetHead ? seoFields(targetHead) : null;

	const fieldDiffs = {};
	if (targetFields) {
		for (const f of FIELDS) {
			if (!eq(sourceFields[f], targetFields[f])) {
				fieldDiffs[f] = { source: sourceFields[f], target: targetFields[f] };
			}
		}
	}
	return { path, targetUrl, error, source: sourceFields, target: targetFields, diffs: fieldDiffs };
});

// --- summary: per-field match/mismatch across pages that were fetched ---
const fetched = results.filter((r) => r.target);
const summary = { targetBase, totalSnapshots: snapshots.length, fetchedOk: fetched.length, targetErrors: results.filter((r) => r.error).length, perField: {} };
for (const f of FIELDS) {
	const mism = fetched.filter((r) => r.diffs[f]).length;
	summary.perField[f] = { match: fetched.length - mism, mismatch: mism };
}

if (asJson) {
	console.log(JSON.stringify({ summary, results }, null, 2));
} else {
	console.log(`SEO diff vs ${targetBase}`);
	console.log(`snapshots: ${summary.totalSnapshots}  fetchedOk: ${summary.fetchedOk}  targetErrors: ${summary.targetErrors}\n`);
	console.log("per-field parity (over fetched pages):");
	for (const f of FIELDS) {
		const p = summary.perField[f];
		const flag = p.mismatch === 0 ? "OK " : "DIFF";
		console.log(`  [${flag}] ${f.padEnd(20)} match ${p.match}/${fetched.length}`);
	}
	console.log("\nsample mismatches (first 2 pages with diffs):");
	let shown = 0;
	for (const r of fetched) {
		if (Object.keys(r.diffs).length === 0 || shown >= 2) continue;
		shown++;
		console.log(`\n  ${r.path}`);
		for (const [f, d] of Object.entries(r.diffs)) {
			console.log(`    ${f}:`);
			console.log(`      src: ${JSON.stringify(d.source)}`);
			console.log(`      tgt: ${JSON.stringify(d.target)}`);
		}
	}
	if (summary.targetErrors) {
		console.log("\ntarget errors:");
		for (const r of results.filter((x) => x.error)) console.log(`  ${r.path} -> ${r.error}`);
	}
}

async function mapLimit(items, limit, fn) {
	const out = new Array(items.length);
	let next = 0;
	async function worker() {
		while (next < items.length) {
			const index = next++;
			out[index] = await fn(items[index], index);
		}
	}
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
	return out;
}
