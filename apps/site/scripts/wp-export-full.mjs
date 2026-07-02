// Full, resumable WordPress extraction (§7.1) — the scale-up of wp-export-sample.mjs.
// Pulls ALL posts (every status), pages, categories, tags, users, and media (with
// srcset variants) via the REST API, then fetches the verbatim Rank Math <head> for
// every PUBLISHED, indexable URL (the source for verbatim head replay).
//
// Resumable:
//   - REST content is written to data/full/content.json; reused unless --refresh.
//   - Head snapshots stream to data/full/heads.jsonl (append-only); a re-run skips URLs
//     already captured, so an interrupted run continues where it stopped.
// Final assembled export: data/wp-full.json (+ data/wp-full-summary.json).
//
// Validation: WP_FULL_LIMIT=N caps posts+pages (per status) so the pipeline can be
// proven end-to-end on a small batch before the full multi-thousand run.
//
// Usage:
//   WP_FULL_LIMIT=50 node --env-file=.env scripts/wp-export-full.mjs   # validate
//   node --env-file=.env scripts/wp-export-full.mjs                    # full run
//   node --env-file=.env scripts/wp-export-full.mjs --refresh          # re-pull REST
import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const WP_BASE_URL = (process.env.WP_BASE_URL || "https://roadtostudy.com").replace(/\/$/, "");
const WP_API = `${WP_BASE_URL}/wp-json`;
const USER = process.env.WP_USERNAME;
const PASS = process.env.WP_APPLICATION_PASSWORD;
const LIMIT = Number(process.env.WP_FULL_LIMIT || 0) || Infinity;
const HEAD_CONCURRENCY = Math.max(1, Number(process.env.WP_HEAD_CONCURRENCY || 4));
const refresh = process.argv.includes("--refresh");

if (!USER || !PASS) throw new Error("WP_USERNAME and WP_APPLICATION_PASSWORD must be set.");
const auth = `Basic ${Buffer.from(`${USER}:${PASS}`).toString("base64")}`;

const DIR = "data/full";
const CONTENT_FILE = `${DIR}/content.json`;
const HEADS_FILE = `${DIR}/heads.jsonl`;

async function wp(path, params = {}) {
	const url = new URL(`${WP_API}${path}`);
	for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, String(v));
	const res = await fetch(url, { headers: { Authorization: auth, Accept: "application/json" } });
	const text = await res.text();
	let body;
	try {
		body = JSON.parse(text);
	} catch {
		body = text;
	}
	if (!res.ok) throw new Error(`WP ${res.status} ${url}: ${JSON.stringify(body).slice(0, 300)}`);
	return { body, totalPages: Number(res.headers.get("x-wp-totalpages") || 0), total: Number(res.headers.get("x-wp-total") || 0) };
}

// Fully paginate a collection (up to `limit`), with basic retry.
async function listAll(path, params = {}, limit = Infinity) {
	const items = [];
	let page = 1;
	for (;;) {
		let result;
		for (let attempt = 1; ; attempt++) {
			try {
				result = await wp(path, { per_page: 100, page, ...params });
				break;
			} catch (err) {
				if (attempt >= 3) throw err;
				await sleep(1000 * attempt);
			}
		}
		if (!Array.isArray(result.body)) break;
		items.push(...result.body);
		if (items.length >= limit || page >= result.totalPages || result.body.length === 0) break;
		page++;
	}
	return items.slice(0, limit);
}

async function expandTranslations(path, items, params = {}) {
	const have = new Set(items.map((i) => i.id));
	const missing = [...new Set(items.flatMap((i) => Object.values(i.translations || {})))].filter((id) => id && !have.has(id));
	const byId = new Map(items.map((i) => [i.id, i]));
	for (let i = 0; i < missing.length; i += 100) {
		const batch = missing.slice(i, i + 100);
		const { body } = await wp(path, { per_page: 100, include: batch.join(","), status: "any", _embed: 1 });
		for (const it of body) byId.set(it.id, it);
	}
	return [...byId.values()];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- HEAD parsing (mirrors wp-export-sample.mjs pickHead) ---
function parseAttrs(tag) {
	const attrs = {};
	for (const m of tag.matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
		const [, key, dq, sq, bare] = m;
		if (!key || key === "meta" || key === "link" || key === "script") continue;
		attrs[key.toLowerCase()] = decodeHtml(dq ?? sq ?? bare ?? "");
	}
	return attrs;
}
function decodeHtml(v) {
	return String(v).replaceAll("&amp;", "&").replaceAll("&quot;", '"').replaceAll("&#039;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">");
}
function pickHead(html) {
	const head = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i)?.[1] || "";
	const metas = [];
	const links = [];
	const jsonLd = [];
	for (const t of head.matchAll(/<meta\b[^>]*>/gi)) {
		const a = parseAttrs(t[0]);
		if (a.name || a.property || a["http-equiv"]) metas.push(a);
	}
	for (const t of head.matchAll(/<link\b[^>]*>/gi)) {
		const a = parseAttrs(t[0]);
		if (a.rel) links.push(a);
	}
	for (const t of head.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
		const raw = t[1]?.trim();
		if (!raw) continue;
		try {
			jsonLd.push(JSON.parse(raw));
		} catch {
			jsonLd.push(raw);
		}
	}
	return {
		title: decodeHtml(head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || ""),
		canonical: links.find((l) => l.rel?.toLowerCase() === "canonical")?.href || null,
		hreflang: links.filter((l) => l.rel?.toLowerCase() === "alternate" && l.hreflang).map((l) => ({ hreflang: l.hreflang, href: l.href })),
		meta: metas,
		jsonLd,
	};
}

async function fetchHead(url) {
	for (let attempt = 1; ; attempt++) {
		try {
			const res = await fetch(url, { headers: { Accept: "text/html" } });
			if (!res.ok) return { url, status: res.status, error: "HEAD_FETCH_FAILED" };
			return { url, status: res.status, ...pickHead(await res.text()) };
		} catch (err) {
			if (attempt >= 3) return { url, status: 0, error: String(err) };
			await sleep(1000 * attempt);
		}
	}
}

// Bounded-concurrency pool.
async function pool(items, worker) {
	let idx = 0;
	const runners = Array.from({ length: Math.min(HEAD_CONCURRENCY, items.length) }, async () => {
		while (idx < items.length) await worker(items[idx++]);
	});
	await Promise.all(runners);
}

// ---- 1. REST content (resumable via content.json) ----
await mkdir(DIR, { recursive: true });
let content;
if (existsSync(CONTENT_FILE) && !refresh) {
	content = JSON.parse(await readFile(CONTENT_FILE, "utf8"));
	console.log(`Reusing ${CONTENT_FILE} (use --refresh to re-pull)`);
} else {
	console.log("Pulling REST content…");
	const [me, types, taxonomies, languages] = await Promise.all([
		wp("/wp/v2/users/me", { context: "edit" }).then((r) => r.body),
		wp("/wp/v2/types", { context: "edit" }).then((r) => r.body),
		wp("/wp/v2/taxonomies", { context: "edit" }).then((r) => r.body),
		wp("/pll/v1/languages").then((r) => r.body).catch((e) => ({ error: e.message })),
	]);
	let posts = await listAll("/wp/v2/posts", { status: "any", _embed: 1, orderby: "date", order: "desc", context: "edit" }, LIMIT);
	let pages = await listAll("/wp/v2/pages", { status: "any", _embed: 1, orderby: "date", order: "desc", context: "edit" }, LIMIT);
	posts = await expandTranslations("/wp/v2/posts", posts);
	pages = await expandTranslations("/wp/v2/pages", pages);
	const [categories, tags, users, media] = await Promise.all([
		listAll("/wp/v2/categories", { hide_empty: false }),
		listAll("/wp/v2/tags", { hide_empty: false }),
		listAll("/wp/v2/users"),
		listAll("/wp/v2/media", { orderby: "date", order: "desc" }, LIMIT === Infinity ? Infinity : LIMIT * 3),
	]);
	content = {
		meta: { source: WP_BASE_URL, limit: LIMIT === Infinity ? "all" : LIMIT, authenticatedUser: { id: me.id, slug: me.slug, roles: me.roles } },
		discovery: { types, taxonomies, languages },
		content: { posts, pages, categories, tags, users, media },
	};
	await writeFile(CONTENT_FILE, JSON.stringify(content));
	console.log(`Pulled: posts=${posts.length} pages=${pages.length} categories=${categories.length} media=${media.length}`);
}

// ---- 2. Head snapshots for published, indexable URLs (resumable via heads.jsonl) ----
const publishedUrls = [
	...content.content.posts.filter((p) => p.status === "publish" && p.link),
	...content.content.pages.filter((p) => p.status === "publish" && p.link),
].map((p) => p.link);

const done = new Set();
if (existsSync(HEADS_FILE)) {
	for (const line of (await readFile(HEADS_FILE, "utf8")).split("\n")) {
		if (!line.trim()) continue;
		try {
			done.add(JSON.parse(line).url);
		} catch {}
	}
}
const todo = publishedUrls.filter((u) => !done.has(u));
console.log(`Head snapshots: ${done.size} already captured, ${todo.length} to fetch…`);
let fetched = 0;
await pool(todo, async (url) => {
	const snap = await fetchHead(url);
	await appendFile(HEADS_FILE, `${JSON.stringify(snap)}\n`);
	if (++fetched % 50 === 0) console.log(`  …${fetched}/${todo.length}`);
});

// ---- 3. Assemble final export ----
const headSnapshots = [];
for (const line of (await readFile(HEADS_FILE, "utf8")).split("\n")) {
	if (!line.trim()) continue;
	try {
		headSnapshots.push(JSON.parse(line));
	} catch {}
}
const exportData = { ...content, seo: { headSnapshots } };
await writeFile("data/wp-full.json", JSON.stringify(exportData));

const summary = {
	source: WP_BASE_URL,
	counts: {
		posts: content.content.posts.length,
		pages: content.content.pages.length,
		categories: content.content.categories.length,
		media: content.content.media.length,
		users: content.content.users.length,
		headSnapshots: headSnapshots.length,
	},
	postStatuses: tally(content.content.posts.map((p) => p.status)),
	postLocales: tally(content.content.posts.map((p) => p.lang || "?")),
	headStatuses: tally(headSnapshots.map((h) => h.status)),
};
await writeFile("data/wp-full-summary.json", JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
console.log("Wrote data/wp-full.json + data/wp-full-summary.json");

function tally(arr) {
	const out = {};
	for (const x of arr) out[x] = (out[x] || 0) + 1;
	return out;
}
