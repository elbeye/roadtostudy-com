import { mkdir, writeFile } from "node:fs/promises";

const WP_BASE_URL = process.env.WP_BASE_URL || "https://roadtostudy.com";
const WP_API_BASE = `${WP_BASE_URL.replace(/\/$/, "")}/wp-json`;
const WP_USERNAME = process.env.WP_USERNAME;
const WP_APPLICATION_PASSWORD = process.env.WP_APPLICATION_PASSWORD;

const limits = {
	posts: Number(process.env.WP_SAMPLE_POSTS || 50),
	pages: Number(process.env.WP_SAMPLE_PAGES || 20),
	media: Number(process.env.WP_SAMPLE_MEDIA || 20),
};

if (!WP_USERNAME || !WP_APPLICATION_PASSWORD) {
	throw new Error("WP_USERNAME and WP_APPLICATION_PASSWORD must be set.");
}

const authHeader = `Basic ${Buffer.from(
	`${WP_USERNAME}:${WP_APPLICATION_PASSWORD}`,
).toString("base64")}`;

async function wp(path, params = {}) {
	const url = new URL(`${WP_API_BASE}${path}`);
	for (const [key, value] of Object.entries(params)) {
		if (value !== undefined && value !== null) {
			url.searchParams.set(key, String(value));
		}
	}

	const response = await fetch(url, {
		headers: {
			Authorization: authHeader,
			Accept: "application/json",
		},
	});
	const text = await response.text();
	let body;
	try {
		body = JSON.parse(text);
	} catch {
		body = text;
	}

	if (!response.ok) {
		throw new Error(`WordPress ${response.status} for ${url}: ${JSON.stringify(body).slice(0, 500)}`);
	}

	return {
		body,
		total: Number(response.headers.get("x-wp-total") || 0),
		totalPages: Number(response.headers.get("x-wp-totalpages") || 0),
	};
}

async function list(path, limit, params = {}) {
	const perPage = Math.min(100, Math.max(1, limit));
	const items = [];
	let page = 1;

	while (items.length < limit) {
		const result = await wp(path, {
			per_page: perPage,
			page,
			context: "edit",
			...params,
		});
		items.push(...result.body);
		if (page >= result.totalPages || result.body.length === 0) break;
		page += 1;
	}

	return items.slice(0, limit);
}

async function getByIds(path, ids, params = {}) {
	const items = [];
	const uniqueIds = [...new Set(ids)].filter(Boolean);
	for (let i = 0; i < uniqueIds.length; i += 100) {
		const batch = uniqueIds.slice(i, i + 100);
		if (batch.length === 0) continue;
		const result = await wp(path, {
			per_page: batch.length,
			include: batch.join(","),
			context: "edit",
			...params,
		});
		items.push(...result.body);
	}
	return items;
}

async function expandWithTranslationSiblings(path, items, params = {}) {
	const existingIds = new Set(items.map((item) => item.id));
	const translationIds = items.flatMap((item) => Object.values(item.translations || {}));
	const missingIds = translationIds.filter((id) => !existingIds.has(id));
	if (missingIds.length === 0) return items;

	const siblings = await getByIds(path, missingIds, params);
	const byId = new Map(items.map((item) => [item.id, item]));
	for (const sibling of siblings) byId.set(sibling.id, sibling);
	return [...byId.values()];
}

function pickHead(html) {
	const head = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i)?.[1] || "";
	const metas = [];
	const links = [];
	const jsonLd = [];

	for (const tag of head.matchAll(/<meta\b[^>]*>/gi)) {
		const attrs = parseAttrs(tag[0]);
		if (attrs.name || attrs.property || attrs["http-equiv"]) metas.push(attrs);
	}
	for (const tag of head.matchAll(/<link\b[^>]*>/gi)) {
		const attrs = parseAttrs(tag[0]);
		if (attrs.rel) links.push(attrs);
	}
	for (const tag of head.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
		const raw = tag[1]?.trim();
		if (!raw) continue;
		try {
			jsonLd.push(JSON.parse(raw));
		} catch {
			jsonLd.push(raw);
		}
	}

	return {
		title: decodeHtml(head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || ""),
		canonical: links.find((link) => link.rel?.toLowerCase() === "canonical")?.href || null,
		hreflang: links
			.filter((link) => link.rel?.toLowerCase() === "alternate" && link.hreflang)
			.map((link) => ({ hreflang: link.hreflang, href: link.href })),
		meta: metas,
		jsonLd,
	};
}

function parseAttrs(tag) {
	const attrs = {};
	for (const match of tag.matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
		const [, key, doubleQuoted, singleQuoted, bare] = match;
		if (!key || key === "meta" || key === "link" || key === "script") continue;
		attrs[key.toLowerCase()] = decodeHtml(doubleQuoted ?? singleQuoted ?? bare ?? "");
	}
	return attrs;
}

function decodeHtml(value) {
	return value
		.replaceAll("&amp;", "&")
		.replaceAll("&quot;", '"')
		.replaceAll("&#039;", "'")
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">");
}

async function getHeadSnapshot(item) {
	if (!item.link) return null;
	const response = await fetch(item.link, { headers: { Accept: "text/html" } });
	if (!response.ok) {
		return { url: item.link, status: response.status, error: "HEAD_FETCH_FAILED" };
	}
	const html = await response.text();
	return { url: item.link, status: response.status, ...pickHead(html) };
}

function summarizeContent(items) {
	return items.map((item) => ({
		id: item.id,
		type: item.type,
		status: item.status,
		lang: item.lang || null,
		slug: item.slug,
		link: item.link,
		title: item.title?.raw || item.title?.rendered || "",
		translations: item.translations || null,
		featured_media: item.featured_media || 0,
		categories: item.categories || [],
		tags: item.tags || [],
	}));
}

const startedAt = new Date().toISOString();
const [me, types, taxonomies, languages, basePosts, basePages, media, categories, tags, users] = await Promise.all([
	wp("/wp/v2/users/me", { context: "edit" }),
	wp("/wp/v2/types", { context: "edit" }),
	wp("/wp/v2/taxonomies", { context: "edit" }),
	wp("/pll/v1/languages").catch((error) => ({ body: { error: error.message } })),
	list("/wp/v2/posts", limits.posts, { status: "any", _embed: 1, orderby: "modified", order: "desc" }),
	list("/wp/v2/pages", limits.pages, { status: "any", _embed: 1, orderby: "modified", order: "desc" }),
	list("/wp/v2/media", limits.media, { orderby: "modified", order: "desc" }),
	list("/wp/v2/categories", 100, { hide_empty: false }),
	list("/wp/v2/tags", 100, { hide_empty: false }),
	list("/wp/v2/users", 100),
]);

const [posts, pages] = await Promise.all([
	expandWithTranslationSiblings("/wp/v2/posts", basePosts, { status: "any", _embed: 1 }),
	expandWithTranslationSiblings("/wp/v2/pages", basePages, { status: "any", _embed: 1 }),
]);

const contentForHead = [...posts.slice(0, 12), ...pages.slice(0, 8)];
const headSnapshots = [];
for (const item of contentForHead) {
	headSnapshots.push(await getHeadSnapshot(item));
}

const exportedAt = new Date().toISOString();
const exportData = {
	meta: {
		startedAt,
		exportedAt,
		source: WP_BASE_URL,
		limits,
		authenticatedUser: {
			id: me.body.id,
			slug: me.body.slug,
			roles: me.body.roles,
		},
	},
	discovery: {
		types: types.body,
		taxonomies: taxonomies.body,
		languages: languages.body,
	},
	content: {
		posts,
		pages,
		media,
		categories,
		tags,
		users,
	},
	seo: {
		headSnapshots,
	},
};

const summary = {
	source: WP_BASE_URL,
	exportedAt,
	counts: {
		posts: posts.length,
		pages: pages.length,
		media: media.length,
		categories: categories.length,
		tags: tags.length,
		users: users.length,
		headSnapshots: headSnapshots.length,
	},
	totals: {
		posts: (await wp("/wp/v2/posts", { per_page: 1, status: "any" })).total,
		pages: (await wp("/wp/v2/pages", { per_page: 1, status: "any" })).total,
		media: (await wp("/wp/v2/media", { per_page: 1 })).total,
		categories: (await wp("/wp/v2/categories", { per_page: 1, hide_empty: false })).total,
		tags: (await wp("/wp/v2/tags", { per_page: 1, hide_empty: false })).total,
	},
	languages: Array.isArray(languages.body)
		? languages.body.map((language) => ({
				slug: language.slug,
				name: language.name,
				locale: language.locale,
			}))
		: languages.body,
	posts: summarizeContent(posts),
	pages: summarizeContent(pages),
	headSnapshotStatuses: headSnapshots.map((snapshot) => ({
		url: snapshot?.url,
		status: snapshot?.status,
		title: snapshot?.title,
		canonical: snapshot?.canonical,
		hreflangCount: snapshot?.hreflang?.length || 0,
		jsonLdCount: snapshot?.jsonLd?.length || 0,
	})),
};

await mkdir("data", { recursive: true });
await writeFile("data/wp-sample.json", `${JSON.stringify(exportData, null, 2)}\n`);
await writeFile("data/wp-sample-summary.json", `${JSON.stringify(summary, null, 2)}\n`);

console.log(JSON.stringify(summary.counts, null, 2));
console.log("Wrote data/wp-sample.json and data/wp-sample-summary.json");
