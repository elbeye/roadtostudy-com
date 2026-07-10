// Push migrated featured_image + verbatim source_seo (Rank Math head) onto the LIVE
// EmDash instance via the authenticated content API (emdash CLI stored login).
// Both are regular declared fields, so the CLI content update accepts them (unlike
// EmDash's native `seo` store, which the CLI rejects). The template renders source_seo
// verbatim (title/description/robots/og/twitter/JSON-LD) for exact SEO parity.
//
// SAFETY:
// - Only PUBLISHED entries are touched (content update auto-publishes; we must not
//   accidentally publish future/draft posts). Drafts are skipped.
// - The full existing data (title/content/excerpt) is re-sent alongside the additions
//   so nothing is dropped, regardless of replace-vs-merge semantics.
// - featured_image carries provider:"external" so EmDash's normalizeMediaValue keeps
//   `src` (it deletes src for provider "local").
//
// Prereq: the `source_seo` (json) field must exist on the live collections
//   (`emdash schema add-field posts source_seo --type json`; same for pages).
//
// Usage:
//   node scripts/push-seo-to-live.mjs --dry-run     # plan only
//   node scripts/push-seo-to-live.mjs --limit 1     # one entry (careful test)
//   node scripts/push-seo-to-live.mjs               # all eligible published entries
import { readFile, writeFile, unlink } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const execFileAsync = promisify(execFile);
const W = process.env.WP_TARGET_BASE || "https://roadtostudy-emdash-poc.murat-elbeye.workers.dev";
const seedInput = process.env.WP_SEED_INPUT || "seed/seed.json";
const dryRun = process.argv.includes("--dry-run");
const limitArg = process.argv.indexOf("--limit");
const limit = limitArg >= 0 ? Number(process.argv[limitArg + 1]) : Infinity;
const concurrency = Math.max(1, Number(process.env.WP_PUSH_CONCURRENCY || 4));

async function cli(args) {
	const { stdout } = await execFileAsync("npx", ["emdash", ...args, "-u", W, "--json"], {
		maxBuffer: 1024 * 1024 * 64,
	});
	return JSON.parse(stdout.match(/[[{][\s\S]*[\]}]/)[0]);
}

// --- source data from the generated seed, keyed by collection|locale|slug ---
const seed = JSON.parse(await readFile(seedInput, "utf8"));
const seedByKey = new Map();
for (const [collection, entries] of [
	["posts", seed.content.posts],
	["pages", seed.content.pages],
]) {
	for (const e of entries) {
		seedByKey.set(`${collection}|${e.locale || "tr"}|${e.slug}`, {
			featured_image: e.data.featured_image ? { ...e.data.featured_image, provider: "external" } : null,
			source_seo: e.data.source_seo || null,
			content_html: e.data.content_html || null,
			wp_published_at: e.data.wp_published_at || null,
			wp_modified_at: e.data.wp_modified_at || null,
		});
	}
}

async function listPublished(collection) {
	const items = [];
	let cursor;
	do {
		const page = await cli(["content", "list", collection, "--limit", "100", ...(cursor ? ["--cursor", cursor] : [])]);
		items.push(...page.items);
		cursor = page.nextCursor;
	} while (cursor);
	return items.filter((e) => e.status === "published");
}

const plan = [];
for (const collection of ["posts", "pages"]) {
	for (const e of await listPublished(collection)) {
		const seedData = seedByKey.get(`${collection}|${e.locale || "tr"}|${e.slug}`);
		if (!seedData || (!seedData.featured_image && !seedData.source_seo && !seedData.content_html)) continue;
		plan.push({ collection, id: e.id, slug: e.slug, locale: e.locale, ...seedData });
	}
}

console.log(JSON.stringify({ W, seedInput, eligible: plan.length, dryRun, concurrency }, null, 2));
if (dryRun) {
	for (const it of plan) console.log(`  ${it.collection} ${it.locale}/${it.slug}  featured=${!!it.featured_image} seo=${!!it.source_seo}`);
	process.exit(0);
}

const results = await mapLimit(plan.slice(0, limit), concurrency, async (it) => {
	let tmp;
	try {
		const item = await cli(["content", "get", it.collection, it.id]);
		const payload = { ...item.data };
		if (it.featured_image) payload.featured_image = it.featured_image;
		if (it.source_seo) payload.source_seo = it.source_seo;
		if (it.content_html) payload.content_html = it.content_html;
		if (it.wp_published_at) payload.wp_published_at = it.wp_published_at;
		if (it.wp_modified_at) payload.wp_modified_at = it.wp_modified_at;
		tmp = join(tmpdir(), `push-seo-${randomUUID()}.json`);
		await writeFile(tmp, JSON.stringify(payload));
		await cli(["content", "update", it.collection, it.id, "--rev", item._rev, "--file", tmp]);
		console.log(`  ✓ ${it.collection} ${it.locale}/${it.slug}`);
		return { entry: `${it.collection}:${it.locale}/${it.slug}`, status: "updated" };
	} catch (error) {
		console.log(`  ✗ ${it.collection} ${it.locale}/${it.slug}: ${String(error?.stderr || error).slice(0, 160)}`);
		return { entry: `${it.collection}:${it.locale}/${it.slug}`, status: "failed", error: String(error?.stderr || error).slice(0, 200) };
	} finally {
		if (tmp) await unlink(tmp).catch(() => {});
	}
});

console.log(JSON.stringify({ attempted: results.length, updated: results.filter((r) => r.status === "updated").length, failed: results.filter((r) => r.status === "failed") }, null, 2));

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
