import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { buildFeaturedImage } from "./wp-media-lib.mjs";
import { htmlToPortableText, decodeHtml, normalizeHtmlHrefs } from "./html-to-portable-text.mjs";

const inputPath = process.env.WP_SAMPLE_INPUT || "data/wp-sample.json";
// Default to the seed the worker actually loads (package.json emdash.seed), so
// regenerating never silently drifts from what gets deployed.
const outputPath = process.env.WP_SEED_OUTPUT || "seed/seed.json";
const includeAuditFields = process.env.WP_SEED_AUDIT_FIELDS === "1";
const includeMediaReferences = process.env.WP_SEED_MEDIA_REFERENCES === "1";
// Store the verbatim source (Rank Math) head per entry so the template can replay
// title/description/robots/og/twitter/canonical/hreflang/JSON-LD exactly (SEO §6.3).
const includeSourceSeo = process.env.WP_SEED_SEO !== "0";
// Store the rendered WordPress body HTML verbatim (preservation-first, §7.2) so the
// template renders it exactly — images, links, tables, heading anchors, FAQ preserved.
const includeContentHtml = process.env.WP_SEED_CONTENT_HTML !== "0";
// Preserve the original WordPress publish/modified dates (§9) for sitemap <lastmod>,
// og:article times, and display — otherwise EmDash's migration timestamps leak out.
const includeDates = process.env.WP_SEED_DATES !== "0";

const source = JSON.parse(await readFile(inputPath, "utf8"));
const headByUrl = new Map(source.seo.headSnapshots.map((snapshot) => [snapshot.url, snapshot]));
const mediaById = new Map(source.content.media.map((item) => [item.id, item]));

const collections = [
	{
		slug: "posts",
		label: "Posts",
		labelSingular: "Post",
		supports: ["drafts", "revisions", "search", "seo"],
		commentsEnabled: false,
		fields: commonFields(true),
	},
	{
		slug: "pages",
		label: "Pages",
		labelSingular: "Page",
		supports: ["drafts", "revisions", "search", "seo"],
		fields: commonFields(false),
	},
];

const seed = {
	$schema: "https://emdashcms.com/seed.schema.json",
	version: "1",
	meta: {
		name: source.meta?.limit && source.meta.limit !== "all"
			? "RoadToStudy WordPress Limited Export"
			: "RoadToStudy WordPress Export",
		description: source.meta?.limit && source.meta.limit !== "all"
			? `Limited WordPress migration export for RoadToStudy (limit=${source.meta.limit}).`
			: "WordPress migration export for RoadToStudy.",
		author: "RoadToStudy migration",
	},
	settings: {
		title: "RoadToStudy",
		tagline: "Study in Turkey guides for international students",
	},
	collections,
	taxonomies: buildTaxonomies(),
	bylines: source.content.users.map((user) => ({
		id: `wp-user-${user.id}`,
		slug: user.slug || `wp-user-${user.id}`,
		displayName: user.name || user.slug || `User ${user.id}`,
	})),
	menus: [
		{
			name: "primary",
			label: "Primary Navigation",
			items: [
				{ type: "custom", label: "Home", url: "/" },
				{ type: "custom", label: "Posts", url: "/posts" },
			],
		},
	],
	content: {
		posts: buildContentEntries(source.content.posts, true),
		pages: buildContentEntries(
			source.content.pages.filter((page) => page.slug),
			false,
		),
	},
};

function commonFields(includePostFields) {
	const fields = [
		{ slug: "title", label: "Title", type: "string", required: true, searchable: true },
		{ slug: "content", label: "Content", type: "portableText", searchable: true },
	];

	if (includeSourceSeo) {
		fields.push({ slug: "source_seo", label: "Source SEO (verbatim head)", type: "json" });
	}

	if (includeContentHtml) {
		fields.push({ slug: "content_html", label: "Body HTML (verbatim)", type: "text" });
	}

	if (includeDates) {
		fields.push(
			{ slug: "wp_published_at", label: "Original Published", type: "datetime" },
			{ slug: "wp_modified_at", label: "Original Modified", type: "datetime" },
		);
	}

	if (includeAuditFields) {
		fields.push(
			{ slug: "wp_id", label: "WordPress ID", type: "integer" },
			{ slug: "wp_lang", label: "WordPress Language", type: "string" },
			{ slug: "wp_source_url", label: "WordPress URL", type: "url" },
			{ slug: "wp_translations", label: "WordPress Translations", type: "json" },
			{ slug: "seo_source", label: "Source SEO Snapshot", type: "json" },
			{ slug: "published_at", label: "Published At", type: "datetime" },
			{ slug: "modified_at", label: "Modified At", type: "datetime" },
		);
	}

	if (includePostFields) {
		fields.splice(
			1,
			0,
			{ slug: "featured_image", label: "Featured Image", type: "image" },
			{ slug: "excerpt", label: "Excerpt", type: "text", searchable: true },
		);
	}

	return fields;
}

function mapContent(item, isPost) {
	const embeddedMedia = item._embedded?.["wp:featuredmedia"]?.[0];
	const media = mediaById.get(item.featured_media) || embeddedMedia;
	const title = cleanText(item.title?.raw || item.title?.rendered || item.slug || `wp-${item.id}`);
	const contentHtml = item.content?.raw || item.content?.rendered || "";
	const excerpt = cleanText(item.excerpt?.raw || item.excerpt?.rendered || "");

	const data = {
		title,
		content: htmlToPortableText(contentHtml),
	};

	if (includeContentHtml) {
		// Prefer rendered HTML (shortcodes expanded, final markup the live site serves).
		data.content_html = cleanHtml(item.content?.rendered || item.content?.raw || "");
	}

	if (includeDates) {
		// WP *_gmt is UTC without a trailing Z; append it for a valid ISO instant.
		const toIso = (d) => (d ? (/[zZ]|[+-]\d\d:?\d\d$/.test(d) ? d : `${d}Z`) : null);
		data.wp_published_at = toIso(item.date_gmt || item.date);
		data.wp_modified_at = toIso(item.modified_gmt || item.modified);
	}

	if (includeAuditFields) {
		data.wp_id = item.id;
		data.wp_lang = item.lang || null;
		data.wp_source_url = item.link || null;
		data.wp_translations = item.translations || {};
		data.seo_source = headByUrl.get(item.link) || null;
		data.published_at = item.date_gmt || item.date || null;
		data.modified_at = item.modified_gmt || item.modified || null;
	}

	if (includeSourceSeo) {
		const sourceSeo = buildSourceSeo(headByUrl.get(item.link));
		if (sourceSeo) data.source_seo = sourceSeo;
	}

	if (isPost) {
		data.excerpt = excerpt;
		if (includeMediaReferences) {
			const featured = buildFeaturedImage(media, title, { baseUrl: process.env.WP_BASE_URL });
			if (featured) data.featured_image = featured;
		}
	}

	return {
		id: `wp-${item.type}-${item.id}`,
		slug: item.slug || `wp-${item.id}`,
		status: item.status === "publish" ? "published" : "draft",
		locale: item.lang || undefined,
		data,
		taxonomies: isPost ? mapTaxonomies(item) : undefined,
	};
}

function buildContentEntries(items, isPost) {
	const entriesByWpId = new Map(items.map((item) => [item.id, mapContent(item, isPost)]));
	const wpItemsById = new Map(items.map((item) => [item.id, item]));
	const seenGroups = new Set();
	const emittedIds = new Set();
	const groupedEntries = [];

	for (const item of items) {
		const groupIds = Object.values(item.translations || {})
			.filter((id) => entriesByWpId.has(id));
		if (!groupIds.includes(item.id)) groupIds.push(item.id);
		groupIds.sort((a, b) => a - b);

		const groupKey = groupIds.join(":");
		if (seenGroups.has(groupKey)) continue;
		seenGroups.add(groupKey);

		const anchorId =
			pickAnchorId(groupIds, wpItemsById) ||
			item.id;
		const anchorEntry = entriesByWpId.get(anchorId);
		if (!anchorEntry) continue;

		if (!emittedIds.has(anchorId)) {
			groupedEntries.push(anchorEntry);
			emittedIds.add(anchorId);
		}
		for (const id of groupIds) {
			if (id === anchorId) continue;
			const entry = entriesByWpId.get(id);
			if (!entry || emittedIds.has(id)) continue;
			entry.translationOf = anchorEntry.id;
			groupedEntries.push(entry);
			emittedIds.add(id);
		}
	}

	return groupedEntries;
}

function pickAnchorId(groupIds, wpItemsById) {
	for (const locale of ["en", "tr", "fr", "id"]) {
		const id = groupIds.find((candidate) => wpItemsById.get(candidate)?.lang === locale);
		if (id) return id;
	}
	return groupIds[0];
}

// Preservation-first body cleanup (§7.2): keep ALL structure verbatim — headings,
// anchors, tables, images, links, lists, FAQ — and only strip active/unsafe content
// (scripts, styles, inline event handlers, javascript: URLs). Aggressive junk-<div>
// removal is deferred: it needs the real corpus + per-pattern diff review, and blind
// stripping risks removing real structure.
// One exception to "verbatim": unambiguously malformed hrefs from the source
// (§6.10 — stacked schemes like `https://https://…`, doubled slash after the
// internal host) are repaired via normalizeHtmlHrefs; valid URLs are untouched.
function cleanHtml(html) {
	if (!html) return "";
	return normalizeHtmlHrefs(
		String(html)
			.replace(/<script[\s\S]*?<\/script>/gi, "")
			.replace(/<style[\s\S]*?<\/style>/gi, "")
			.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
			.replace(/((?:href|src)\s*=\s*)("javascript:[^"]*"|'javascript:[^']*')/gi, '$1"#"'),
	).trim();
}

function buildSourceSeo(snap) {
	if (!snap || snap.status !== 200) return null;
	const metaOf = (key) =>
		(snap.meta || []).find((m) => m.name === key || m.property === key)?.content || null;
	const relPath = (url) => {
		if (!url) return null;
		try {
			return new URL(url).pathname;
		} catch {
			return url;
		}
	};
	return {
		title: snap.title || null,
		description: metaOf("description"),
		robots: metaOf("robots"),
		ogTitle: metaOf("og:title"),
		ogDescription: metaOf("og:description"),
		ogImage: relPath(metaOf("og:image")),
		twitterCard: metaOf("twitter:card"),
		twitterTitle: metaOf("twitter:title"),
		twitterDescription: metaOf("twitter:description"),
		canonicalPath: relPath(snap.canonical),
		hreflang: (snap.hreflang || []).map((h) => ({ hreflang: h.hreflang, href: relPath(h.href) })),
		jsonLd: snap.jsonLd || [],
	};
}

function mapTaxonomies(item) {
	const categoryById = new Map(source.content.categories.map((category) => [category.id, category]));
	const terms = item.categories
		?.map((id) => categoryById.get(id)?.slug)
		.filter(Boolean);
	return terms?.length ? { category: terms } : undefined;
}

function buildTaxonomies() {
	const locales = ["en", "tr", "fr", "id"];
	const labelByLocale = {
		en: ["Categories", "Category"],
		tr: ["Kategoriler", "Kategori"],
		fr: ["Categories", "Categorie"],
		id: ["Kategori", "Kategori"],
	};
	const categoryById = new Map(source.content.categories.map((category) => [category.id, category]));

	return locales.map((locale) => {
		const [label, labelSingular] = labelByLocale[locale] || labelByLocale.en;
		const terms = source.content.categories
			.filter((category) => category.lang === locale)
			.map((category) => {
				const enId = category.translations?.en;
				const sourceCategory = enId ? categoryById.get(enId) : null;
				return {
					id: `term:category:${category.id}`,
					slug: category.slug,
					label: category.name,
					locale,
					translationOf:
						locale !== "en" && sourceCategory
							? `term:category:${sourceCategory.id}`
							: undefined,
				};
			});

		return {
			id: `tax:category:${locale}`,
			name: "category",
			label,
			labelSingular,
			hierarchical: true,
			collections: ["posts"],
			locale,
			translationOf: locale === "en" ? undefined : "tax:category:en",
			terms,
		};
	});
}

function cleanText(value) {
	return decodeHtml(
		String(value || "")
			.replace(/<script[\s\S]*?<\/script>/gi, " ")
			.replace(/<style[\s\S]*?<\/style>/gi, " ")
			.replace(/<[^>]+>/g, " ")
			.replace(/\s+/g, " ")
			.trim(),
	);
}

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(seed, null, 2)}\n`);

const postEntries = seed.content.posts;
const pageEntries = seed.content.pages;
const allEntries = [...postEntries, ...pageEntries];
const allCategoryTerms = seed.taxonomies.flatMap((taxonomy) => taxonomy.terms || []);

console.log(
	JSON.stringify(
		{
			outputPath,
			sourceLimit: source.meta?.limit ?? null,
			posts: postEntries.length,
			pages: pageEntries.length,
			categories: allCategoryTerms.length,
			bylines: seed.bylines.length,
			featuredImages: postEntries.filter((entry) => entry.data.featured_image).length,
			sourceSeoEntries: allEntries.filter((entry) => entry.data.source_seo).length,
			contentHtmlEntries: allEntries.filter((entry) => entry.data.content_html).length,
		},
		null,
		2,
	),
);
