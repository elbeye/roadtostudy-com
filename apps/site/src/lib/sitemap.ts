// Rank Math-compatible sitemap building. The source site exposes
//   /sitemap_index.xml -> /post-sitemap{n}.xml + /page-sitemap{n}.xml + /category-sitemap.xml
// with 200 URLs per sub-sitemap (numbered from 1). We replicate that exact structure so
// the URLs Google already indexed keep resolving (spec §6.6).
import { getEmDashCollection, getTaxonomyTerms } from "emdash";
import { getDb } from "emdash/runtime";

import { contentPath, categoryPath } from "../utils/content-url";

export const SITEMAP_PAGE_SIZE = 200;
export const SITEMAP_DEFAULT_LOCALE = "tr";

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

export async function getPublishedStats(collection: SitemapCollection, locale = SITEMAP_DEFAULT_LOCALE): Promise<PublishedStats> {
	const db = (await getDb()) as any;
	const row = await db
		.selectFrom(tableForCollection(collection))
		.select((eb: any) => [eb.fn.count("id").as("count"), eb.fn.max("wp_modified_at").as("lastmod")])
		.where("deleted_at", "is", null)
		.where("status", "=", "published")
		.where("locale", "=", locale)
		.executeTakeFirst();

	return {
		count: Number(row?.count || 0),
		lastmod: isoLastmod(row?.lastmod ? new Date(row.lastmod) : null),
	};
}

export async function getPublishedSitemapEntries(collection: SitemapCollection, page: number, locale = SITEMAP_DEFAULT_LOCALE): Promise<any[]> {
	const db = (await getDb()) as any;
	const rows = await db
		.selectFrom(tableForCollection(collection))
		.select(["id", "slug", "locale", "wp_modified_at", "wp_published_at", "updated_at", "published_at"])
		.where("deleted_at", "is", null)
		.where("status", "=", "published")
		.where("locale", "=", locale)
		.orderBy("published_at", "desc")
		.limit(SITEMAP_PAGE_SIZE)
		.offset((page - 1) * SITEMAP_PAGE_SIZE)
		.execute();

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
