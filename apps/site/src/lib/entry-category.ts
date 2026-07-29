import { getDb } from "emdash/runtime";

// Resolve an entry's category term in a given locale.
//
// Why this exists instead of getTermsForEntries("posts", [id], "category", { locale }):
// that helper joins `taxonomies.translation_group = content_taxonomies.taxonomy_id`, i.e.
// it expects the link row to store a translation GROUP and then picks the locale's term
// off that group. This database stores the locale-specific term's own `id` there — that is
// what the 2026-07-28 repair wrote when it moved every post off the EN term and onto the
// term in its own locale.
//
// Both shapes are self-consistent; they just aren't the same shape. The consequence is
// narrow but total: only the 10 terms that happen to BE their group's root satisfy the
// library's join, and all 10 roots are EN. So the library helper returns the category for
// EN posts and nothing for TR/FR/ID — the entire unprefixed corpus included.
//
// This joins on `id`, matching the data as it actually is. Locale-scoped, so a post gets
// the term in its own language.
//
// If the link rows are ever migrated to hold translation_group instead, delete this and go
// back to getTermsForEntries — but verify the archives first, since their collection query
// resolves the link a different way and currently works against this shape.
export type EntryCategory = { slug: string; label: string };

const TABLE_FOR_COLLECTION: Record<string, string> = { posts: "ec_posts", pages: "ec_pages" };

export async function getEntryCategory(
	collection: string,
	entryId: string,
	locale: string,
): Promise<EntryCategory | null> {
	if (!TABLE_FOR_COLLECTION[collection] || !entryId) return null;
	const db = (await getDb()) as any;
	const rows = await db
		.selectFrom("content_taxonomies")
		.innerJoin("taxonomies", "taxonomies.id", "content_taxonomies.taxonomy_id")
		.select(["taxonomies.slug as slug", "taxonomies.label as label"])
		.where("content_taxonomies.collection", "=", collection)
		.where("content_taxonomies.entry_id", "=", entryId)
		.where("taxonomies.name", "=", "category")
		.where("taxonomies.locale", "=", locale)
		// Stable pick when a post carries more than one category, matching the ordering
		// getTermsForEntries uses so the chip doesn't change between the two code paths.
		.orderBy("taxonomies.label", "asc")
		.limit(1)
		.execute();
	const row = rows[0];
	return row?.slug ? { slug: row.slug, label: row.label ?? row.slug } : null;
}
