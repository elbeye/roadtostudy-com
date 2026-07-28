import { getDb } from "emdash/runtime";

import { contentPath } from "../utils/content-url";

// EmDash's LiveSearch links each result to /{collection}/{slug} (e.g. /posts/foo).
// That is NOT this site's URL scheme — content lives at /{slug}/ (TR) or
// /{locale}/{slug}/ (en/fr/id) — so those links 404. Search is cross-locale and the
// result payload drops the locale, so resolve by slug against the DB (which carries
// locale) and return the canonical path to 301 to. Returns null when no published
// entry matches, so the caller can fall through to a real 404.
const TABLE_FOR_COLLECTION: Record<string, string> = { posts: "ec_posts", pages: "ec_pages" };

export async function resolveCollectionSlugPath(collection: string, slug: string): Promise<string | null> {
	const table = TABLE_FOR_COLLECTION[collection];
	if (!table) return null;
	const db = (await getDb()) as any;
	const rows = await db
		.selectFrom(table)
		.select(["slug", "locale"])
		.where("slug", "=", slug)
		.where("deleted_at", "is", null)
		.where("status", "=", "published")
		.execute();
	const row = rows[0];
	return row ? contentPath(row.locale, row.slug) : null;
}
