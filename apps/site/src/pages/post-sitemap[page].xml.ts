import type { APIRoute } from "astro";

import {
	entryLastmod,
	entryUrl,
	getPublishedSitemapEntries,
	getPublishedStats,
	isoLastmod,
	renderUrlSet,
	xmlResponse,
	type SitemapUrl,
} from "../lib/sitemap";

export const prerender = false;

export const GET: APIRoute = async ({ url, params }) => {
	const origin = url.origin;
	const page = Number(params.page) || 1;
	const [stats, posts] = await Promise.all([getPublishedStats("posts"), getPublishedSitemapEntries("posts", page)]);
	if (posts.length === 0 && page !== 1) return new Response("Not Found", { status: 404 });

	const urls: SitemapUrl[] = [];
	// Rank Math includes the homepage as the first entry of post-sitemap1.
	if (page === 1) {
		urls.push({ loc: `${origin}/`, lastmod: stats.lastmod });
	}
	for (const post of posts) {
		urls.push({ loc: entryUrl(origin, post), lastmod: isoLastmod(entryLastmod(post)) });
	}
	return xmlResponse(renderUrlSet(urls));
};
