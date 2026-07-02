// Push migrated featured_image + Rank Math meta description onto the LIVE EmDash
// instance via the authenticated content API (emdash CLI stored login).
//
// SAFETY:
// - Only PUBLISHED posts are touched (content update auto-publishes; we must not
//   accidentally publish future/draft posts). Drafts are skipped.
// - The full existing data (title/content/excerpt) is re-sent alongside the
//   additions so nothing is dropped, regardless of replace-vs-merge semantics.
// - seo only carries { description } here (title/robots/JSON-LD are a later
//   template phase; setting seo.title would double the site-title suffix).
//
// Usage:
//   node scripts/push-seo-to-live.mjs --dry-run          # plan only, no writes
//   node scripts/push-seo-to-live.mjs --limit 1          # do 1 post (careful test)
//   node scripts/push-seo-to-live.mjs                    # all eligible published posts
import { readFile, writeFile, unlink } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const execFileAsync = promisify(execFile);
const W = process.env.WP_TARGET_BASE || "https://roadtostudy-emdash-poc.murat-elbeye.workers.dev";
const dryRun = process.argv.includes("--dry-run");
const limitArg = process.argv.indexOf("--limit");
const limit = limitArg >= 0 ? Number(process.argv[limitArg + 1]) : Infinity;

async function cli(args) {
	const { stdout } = await execFileAsync("npx", ["emdash", ...args, "-u", W, "--json"], {
		maxBuffer: 1024 * 1024 * 64,
	});
	return JSON.parse(stdout.match(/[[{][\s\S]*[\]}]/)[0]);
}

// --- source data: featured_image (seed) + description (head snapshot), keyed by slug|locale ---
const seed = JSON.parse(await readFile("seed/seed.json", "utf8"));
const wp = JSON.parse(await readFile("data/wp-sample.json", "utf8"));

const featuredByKey = new Map();
for (const p of seed.content.posts) {
	if (p.data.featured_image) featuredByKey.set(`${p.locale}|${p.slug}`, p.data.featured_image);
}

// description per source URL path (/slug/ or /locale/slug/)
const descByPath = new Map();
for (const snap of wp.seo?.headSnapshots || []) {
	if (!snap?.url) continue;
	const desc = (snap.meta || []).find((m) => m.name === "description" || m.property === "description")?.content;
	if (!desc) continue;
	try {
		descByPath.set(new URL(snap.url).pathname, desc);
	} catch {}
}
function descFor(locale, slug) {
	const path = locale && locale !== "tr" ? `/${locale}/${slug}/` : `/${slug}/`;
	return descByPath.get(path) || null;
}

// --- list all published posts (paginate) ---
const posts = [];
let cursor;
do {
	const page = await cli(["content", "list", "posts", "--limit", "100", ...(cursor ? ["--cursor", cursor] : [])]);
	posts.push(...page.items);
	cursor = page.nextCursor;
} while (cursor);

const published = posts.filter((p) => p.status === "published");

const plan = [];
for (const p of published) {
	const key = `${p.locale}|${p.slug}`;
	const featured = featuredByKey.get(key) || null;
	const description = descFor(p.locale, p.slug);
	// NOTE: seo.description is NOT pushed here — the CLI content update rejects a
	// `seo` key as an unknown field (seo writes need the API/plugin path, deferred).
	// Only featured_image (a declared field) is applied, which fixes og:image.
	if (!featured) continue;
	plan.push({ id: p.id, slug: p.slug, locale: p.locale, featured: !!featured, description: !!description, _featured: featured, _description: description });
}

console.log(JSON.stringify({ W, totalPosts: posts.length, published: published.length, eligible: plan.length, dryRun }, null, 2));
if (dryRun) {
	for (const it of plan.slice(0, 10)) console.log(`  ${it.locale}/${it.slug}  featured=${it.featured} desc=${it.description}`);
	process.exit(0);
}

const results = [];
let done = 0;
for (const it of plan) {
	if (done >= limit) break;
	done++;
	let tmp;
	try {
		const item = await cli(["content", "get", "posts", it.id]);
		// provider:"external" is REQUIRED: EmDash's normalizeMediaValue deletes `src`
		// for provider "local" (media-library refs), keeping it only for "external".
		// Our images live at the preserved /wp-content/uploads/ path (not EmDash media),
		// so they must be external to survive normalization.
		const payload = { ...item.data, featured_image: { ...it._featured, provider: "external" } };
		tmp = join(tmpdir(), `push-seo-${randomUUID()}.json`);
		await writeFile(tmp, JSON.stringify(payload));
		await cli(["content", "update", "posts", it.id, "--rev", item._rev, "--file", tmp]);
		results.push({ slug: `${it.locale}/${it.slug}`, status: "updated" });
		console.log(`  ✓ ${it.locale}/${it.slug}`);
	} catch (error) {
		results.push({ slug: `${it.locale}/${it.slug}`, status: "failed", error: String(error?.stderr || error).slice(0, 200) });
		console.log(`  ✗ ${it.locale}/${it.slug}: ${String(error?.stderr || error).slice(0, 160)}`);
	} finally {
		if (tmp) await unlink(tmp).catch(() => {});
	}
}

console.log(JSON.stringify({ attempted: results.length, updated: results.filter((r) => r.status === "updated").length, failed: results.filter((r) => r.status === "failed") }, null, 2));
