import type { APIRoute } from "astro";

import {
	getAllPublished,
	entryLastmod,
	entryUrl,
	isoLastmod,
	latestLastmod,
	renderUrlSet,
	xmlResponse,
	pageSlice,
	type SitemapUrl,
} from "../lib/sitemap";

export const prerender = false;

export const GET: APIRoute = async ({ url, params }) => {
	const origin = url.origin;
	const page = Number(params.page) || 1;
	const posts = await getAllPublished("posts");
	const slice = pageSlice(posts, page);
	if (slice.length === 0 && page !== 1) return new Response("Not Found", { status: 404 });

	const urls: SitemapUrl[] = [];
	// Rank Math includes the homepage as the first entry of post-sitemap1.
	if (page === 1) {
		urls.push({ loc: `${origin}/`, lastmod: latestLastmod(posts) });
	}
	for (const post of slice) {
		urls.push({ loc: entryUrl(origin, post), lastmod: isoLastmod(entryLastmod(post)) });
	}
	return xmlResponse(renderUrlSet(urls));
};
