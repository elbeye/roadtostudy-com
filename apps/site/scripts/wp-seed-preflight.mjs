import { readFile, stat } from "node:fs/promises";

const inputPath = argValue("--input") || process.env.WP_SEED_INPUT || "seed/seed.json";
const maxBytes = positiveNumber(process.env.WP_SEED_MAX_BYTES, 200 * 1024 * 1024);
const maxEstimatedRowsWritten = positiveNumber(process.env.WP_D1_MAX_ESTIMATED_ROWS_WRITTEN, 90000);
const rowsPerEntry = positiveNumber(process.env.WP_D1_ESTIMATED_ROWS_PER_ENTRY, 20);
const rowsPerTerm = positiveNumber(process.env.WP_D1_ESTIMATED_ROWS_PER_TERM, 5);
const rowsPerByline = positiveNumber(process.env.WP_D1_ESTIMATED_ROWS_PER_BYLINE, 2);

const bytes = (await stat(inputPath)).size;
const seed = JSON.parse(await readFile(inputPath, "utf8"));
const posts = seed.content?.posts || [];
const pages = seed.content?.pages || [];
const entries = [...posts, ...pages];
const terms = (seed.taxonomies || []).flatMap((taxonomy) => taxonomy.terms || []);
const bylines = seed.bylines || [];

const estimatedRowsWritten =
	entries.length * rowsPerEntry +
	terms.length * rowsPerTerm +
	bylines.length * rowsPerByline +
	(seed.collections?.length || 0) * 10 +
	(seed.taxonomies?.length || 0) * 10 +
	(seed.menus?.length || 0) * 5;

const malformedImages = posts.filter((entry) => {
	const image = entry.data?.featured_image;
	if (!image) return false;
	return image.$media || !String(image.src || "").startsWith("/wp-content/uploads/");
});

const duplicateKeys = duplicateEntryKeys(entries);
const summary = {
	inputPath,
	bytes,
	mb: Number((bytes / 1024 / 1024).toFixed(1)),
	limits: {
		maxMb: Number((maxBytes / 1024 / 1024).toFixed(1)),
		maxEstimatedRowsWritten,
		rowsPerEntry,
		rowsPerTerm,
		rowsPerByline,
	},
	counts: {
		posts: posts.length,
		pages: pages.length,
		entries: entries.length,
		taxonomies: seed.taxonomies?.length || 0,
		terms: terms.length,
		bylines: bylines.length,
		menus: seed.menus?.length || 0,
		featuredImages: posts.filter((entry) => entry.data?.featured_image).length,
		sourceSeoEntries: entries.filter((entry) => entry.data?.source_seo).length,
		contentHtmlEntries: entries.filter((entry) => entry.data?.content_html).length,
	},
	postStatuses: tally(posts.map((entry) => entry.status || "?")),
	pageStatuses: tally(pages.map((entry) => entry.status || "?")),
	postLocales: tally(posts.map((entry) => entry.locale || "tr")),
	pageLocales: tally(pages.map((entry) => entry.locale || "tr")),
	estimatedRowsWritten,
	issues: [],
};

if (bytes > maxBytes) {
	summary.issues.push({
		code: "SEED_BYTES_LIMIT",
		message: `Seed file is larger than WP_SEED_MAX_BYTES (${summary.mb} MB > ${summary.limits.maxMb} MB).`,
	});
}

if (estimatedRowsWritten > maxEstimatedRowsWritten) {
	summary.issues.push({
		code: "D1_ROWS_WRITTEN_GUARD",
		message: `Estimated rows_written exceeds WP_D1_MAX_ESTIMATED_ROWS_WRITTEN (${estimatedRowsWritten} > ${maxEstimatedRowsWritten}).`,
	});
}

if (malformedImages.length > 0) {
	summary.issues.push({
		code: "MALFORMED_FEATURED_IMAGES",
		message: `${malformedImages.length} featured_image values are not plain /wp-content/uploads paths.`,
		sample: malformedImages.slice(0, 5).map((entry) => `${entry.locale || "tr"}/${entry.slug}`),
	});
}

if (duplicateKeys.length > 0) {
	summary.issues.push({
		code: "DUPLICATE_ENTRY_KEYS",
		message: `${duplicateKeys.length} duplicate collection/locale/slug keys found.`,
		sample: duplicateKeys.slice(0, 10),
	});
}

console.log(JSON.stringify(summary, null, 2));
if (summary.issues.length > 0) process.exit(2);

function argValue(name) {
	const index = process.argv.indexOf(name);
	return index >= 0 ? process.argv[index + 1] : null;
}

function positiveNumber(value, fallback) {
	const number = Number(value);
	return Number.isFinite(number) && number > 0 ? number : fallback;
}

function tally(values) {
	const out = {};
	for (const value of values) out[value] = (out[value] || 0) + 1;
	return out;
}

function duplicateEntryKeys(entries) {
	const seen = new Set();
	const duplicates = new Set();
	for (const entry of entries) {
		const key = `${entry.locale || "tr"}:${entry.slug}`;
		if (seen.has(key)) duplicates.add(key);
		seen.add(key);
	}
	return [...duplicates].sort();
}
