import { mkdir, readFile, writeFile } from "node:fs/promises";

const inputPath = process.env.WP_SAMPLE_INPUT || "data/wp-sample.json";
const outputPath = process.env.WP_SEED_OUTPUT || "data/wp-sample.emdash-seed.json";
const includeAuditFields = process.env.WP_SEED_AUDIT_FIELDS === "1";
const includeMediaReferences = process.env.WP_SEED_MEDIA_REFERENCES === "1";

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
		name: "RoadToStudy WordPress Sample",
		description: "Small WordPress migration PoC export for RoadToStudy.",
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

	if (includeAuditFields) {
		fields.push(
			{ slug: "content_html", label: "Source HTML", type: "text" },
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

	if (includeAuditFields) {
		data.content_html = contentHtml;
		data.wp_id = item.id;
		data.wp_lang = item.lang || null;
		data.wp_source_url = item.link || null;
		data.wp_translations = item.translations || {};
		data.seo_source = headByUrl.get(item.link) || null;
		data.published_at = item.date_gmt || item.date || null;
		data.modified_at = item.modified_gmt || item.modified || null;
	}

	if (isPost) {
		data.excerpt = excerpt;
		if (includeMediaReferences && media?.source_url) {
			data.featured_image = {
				$media: {
					url: media.source_url,
					alt: media.alt_text || title,
					filename: filenameFromUrl(media.source_url),
				},
			};
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

function htmlToPortableText(html) {
	const blocks = [];
	let index = 0;
	const matches = [...html.matchAll(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>|<p[^>]*>([\s\S]*?)<\/p>|<li[^>]*>([\s\S]*?)<\/li>/gi)];

	for (const match of matches) {
		const headingLevel = match[1];
		const raw = match[2] || match[3] || match[4] || "";
		const text = cleanText(raw);
		if (!text) continue;
		blocks.push(block(text, headingLevel ? `h${Math.min(Number(headingLevel), 4)}` : "normal", index++));
	}

	if (blocks.length === 0) {
		const text = cleanText(html);
		if (text) blocks.push(block(text, "normal", index++));
	}

	return blocks;
}

function block(text, style, index) {
	return {
		_type: "block",
		style,
		children: [
			{
				_type: "span",
				text,
				_key: `s${index}`,
			},
		],
		_key: `b${index}`,
	};
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

function decodeHtml(value) {
	return value
		.replaceAll("&nbsp;", " ")
		.replaceAll("&amp;", "&")
		.replaceAll("&quot;", '"')
		.replaceAll("&#039;", "'")
		.replaceAll("&#8217;", "'")
		.replaceAll("&#8211;", "-")
		.replaceAll("&#8212;", "-")
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">");
}

function filenameFromUrl(value) {
	try {
		return decodeURIComponent(new URL(value).pathname.split("/").pop() || "media");
	} catch {
		return "media";
	}
}

await mkdir("data", { recursive: true });
await writeFile(outputPath, `${JSON.stringify(seed, null, 2)}\n`);

console.log(
	JSON.stringify(
		{
			outputPath,
			posts: seed.content.posts.length,
			pages: seed.content.pages.length,
			categories: seed.taxonomies[0].terms.length,
			bylines: seed.bylines.length,
		},
		null,
		2,
	),
);
