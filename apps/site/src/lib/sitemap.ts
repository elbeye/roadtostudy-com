// Rank Math-compatible sitemap building. The source site exposes
//   /sitemap_index.xml -> /post-sitemap{n}.xml + /page-sitemap{n}.xml + /category-sitemap.xml
// with 200 URLs per sub-sitemap (numbered from 1). We replicate that exact structure so
// the URLs Google already indexed keep resolving (spec §6.6).
import { getEmDashCollection, getTaxonomyTerms } from "emdash";
import { getDb } from "emdash/runtime";

import { contentPath, categoryPath } from "../utils/content-url";

export const SITEMAP_PAGE_SIZE = 200;

// Rank Math omits these published posts from the source post sitemaps even though
// their page robots meta is indexable. Preserve sitemap membership exactly; the
// pages still render normally and can be linked/crawled outside the sitemap.
const SOURCE_SITEMAP_EXCLUDED_PATHS = new Set([
	"/en/academic-writing-in-turkish-a-guide-to-writing-articles-and-theses/",
	"/en/language-psychology-and-methods-for-learning-turkish/",
	"/en/methods-for-boosting-motivation-in-turkish-language-learning/",
	"/en/turkish-learning-tips-for-arabic-speakers/",
	"/en/turkish-learning-tips-for-english-speakers/",
	"/fr/apprenez-le-turc-avec-les-reseaux-sociaux/",
	"/fr/debouches-professionnels-en-architecture-et-design-en-turquie/",
	"/fr/guide-du-respect-dans-la-societe-turque-manieres-et-importance/",
	"/fr/la-culture-du-cadeau-en-turquie-traditions-et-suggestions/",
	"/fr/la-structure-familiale-et-les-relations-sociales-en-turquie/",
	"/fr/limportance-du-langage-corporel-et-des-gestes-en-turquie/",
	"/fr/quelles-sont-les-traditions-du-ramadan-et-des-fetes-religieuses-en-turquie/",
	"/fr/sensibilites-religieuses-et-regles-de-respect-en-turquie/",
	"/fr/shabiller-en-turquie-au-quotidien-et-pour-les-occasions-speciales/",
	"/id/cara-mengembangkan-keterampilan-membaca-dalam-bahasa-turki/",
	"/id/idiom-dan-peribahasa-dalam-bahasa-turki-makna-dan-penggunaannya/",
	"/id/metode-untuk-meningkatkan-keterampilan-menulis-dalam-bahasa-turki/",
	"/id/panduan-penilaian-level-dan-sertifikasi-bahasa-turki/",
	"/id/slang-dan-penggunaan-bahasa-sehari-hari-dalam-bahasa-turki/",
	"/id/ungkapan-sopan-santun-dan-penggunaan-bahasa-formal-dalam-bahasa-turki/",
]);

const XML_ESCAPE: ReadonlyArray<readonly [RegExp, string]> = [
	[/&/g, "&amp;"],
	[/</g, "&lt;"],
	[/>/g, "&gt;"],
	[/"/g, "&quot;"],
	[/'/g, "&apos;"],
];

export function escapeXml(str: string): string {
	let out = str;
	for (const [re, rep] of XML_ESCAPE) out = out.replace(re, rep);
	return out;
}

// Rank Math lastmod format: 2026-04-17T09:44:00+00:00 (no milliseconds, +00:00 offset).
export function isoLastmod(date: Date | null | undefined): string | null {
	if (!date) return null;
	return date.toISOString().replace(/\.\d{3}Z$/, "+00:00");
}

export type SitemapUrl = { loc: string; lastmod?: string | null };

export function renderUrlSet(urls: SitemapUrl[]): string {
	const body = urls
		.map(
			(u) =>
				`  <url>\n    <loc>${escapeXml(u.loc)}</loc>${u.lastmod ? `\n    <lastmod>${u.lastmod}</lastmod>` : ""}\n  </url>`,
		)
		.join("\n");
	return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>`;
}

export function renderSitemapIndex(sitemaps: SitemapUrl[]): string {
	const body = sitemaps
		.map(
			(s) =>
				`  <sitemap>\n    <loc>${escapeXml(s.loc)}</loc>${s.lastmod ? `\n    <lastmod>${s.lastmod}</lastmod>` : ""}\n  </sitemap>`,
		)
		.join("\n");
	return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</sitemapindex>`;
}

export function xmlResponse(xml: string): Response {
	return new Response(xml, {
		headers: {
			"Content-Type": "application/xml; charset=utf-8",
			"Cache-Control": "public, max-age=3600",
		},
	});
}

// Gather every published entry of a collection (cursor loop), newest first.
export async function getAllPublished(collection: string): Promise<any[]> {
	const all: any[] = [];
	let cursor: string | undefined;
	do {
		const { entries, nextCursor } = await getEmDashCollection(collection, {
			limit: 100,
			cursor,
			orderBy: { published_at: "desc" },
		});
		all.push(...entries);
		cursor = nextCursor ?? undefined;
	} while (cursor);
	return all;
}

export function entryLastmod(entry: any): Date | null {
	// Prefer the original WordPress modified date (§9) so <lastmod> reflects real
	// content freshness, not the migration timestamp. Fields may come back as ISO
	// strings or Date objects depending on the field type.
	const raw =
		entry?.data?.wp_modified_at ??
		entry?.data?.wp_published_at ??
		entry?.data?.updatedAt ??
		entry?.data?.publishedAt ??
		null;
	if (!raw) return null;
	const d = raw instanceof Date ? raw : new Date(raw);
	return Number.isNaN(d.getTime()) ? null : d;
}

// Newest lastmod across a set of entries, in Rank Math's ISO format (or null).
export function latestLastmod(entries: any[]): string | null {
	const times = entries
		.map(entryLastmod)
		.filter((d): d is Date => !!d)
		.map((d) => d.getTime());
	return times.length ? isoLastmod(new Date(Math.max(...times))) : null;
}

export function entryUrl(origin: string, entry: any): string {
	return `${origin}${contentPath(entry.data?.locale, entry.data?.slug || entry.id)}`;
}

type SitemapCollection = "posts" | "pages";
type PublishedStats = { count: number; lastmod: string | null };

function tableForCollection(collection: SitemapCollection) {
	return collection === "posts" ? "ec_posts" : "ec_pages";
}

function isSourceSitemapExcluded(collection: SitemapCollection, row: { locale?: string | null; slug?: string | null }) {
	return collection === "posts" && SOURCE_SITEMAP_EXCLUDED_PATHS.has(contentPath(row.locale, row.slug));
}

export async function getPublishedStats(collection: SitemapCollection, locale?: string | null): Promise<PublishedStats> {
	const db = (await getDb()) as any;
	let query = db
		.selectFrom(tableForCollection(collection))
		.select(["slug", "locale", "wp_modified_at", "wp_published_at", "updated_at", "published_at"])
		.where("deleted_at", "is", null)
		.where("status", "=", "published");
	if (locale) query = query.where("locale", "=", locale);
	const rows = (await query.execute()).filter((row: any) => !isSourceSitemapExcluded(collection, row));
	const times = rows
		.map((row: any) => row.wp_modified_at ?? row.wp_published_at ?? row.updated_at ?? row.published_at)
		.map((value: any) => (value ? new Date(value).getTime() : NaN))
		.filter((time: number) => Number.isFinite(time));

	return {
		count: rows.length,
		lastmod: times.length ? isoLastmod(new Date(Math.max(...times))) : null,
	};
}

export async function getPublishedSitemapEntries(collection: SitemapCollection, page: number, locale?: string | null): Promise<any[]> {
	const db = (await getDb()) as any;
	let query = db
		.selectFrom(tableForCollection(collection))
		.select(["id", "slug", "locale", "wp_modified_at", "wp_published_at", "updated_at", "published_at"])
		.where("deleted_at", "is", null)
		.where("status", "=", "published")
		.orderBy("published_at", "desc")
		.orderBy("id", "desc");
	if (locale) query = query.where("locale", "=", locale);
	const rows = (await query.execute())
		.filter((row: any) => !isSourceSitemapExcluded(collection, row))
		.slice((page - 1) * SITEMAP_PAGE_SIZE, page * SITEMAP_PAGE_SIZE);

	return rows.map((row: any) => ({
		id: row.id,
		data: {
			slug: row.slug,
			locale: row.locale,
			wp_modified_at: row.wp_modified_at,
			wp_published_at: row.wp_published_at,
			updatedAt: row.updated_at,
			publishedAt: row.published_at,
		},
	}));
}

// Slice a list into 1-indexed pages of SITEMAP_PAGE_SIZE.
export function pageSlice<T>(items: T[], page: number): T[] {
	const start = (page - 1) * SITEMAP_PAGE_SIZE;
	return items.slice(start, start + SITEMAP_PAGE_SIZE);
}

export function pageCount(total: number): number {
	return Math.max(1, Math.ceil(total / SITEMAP_PAGE_SIZE));
}

export { getTaxonomyTerms, categoryPath };
