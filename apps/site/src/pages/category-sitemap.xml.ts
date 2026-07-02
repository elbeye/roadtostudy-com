import type { APIRoute } from "astro";

import {
	getAllPublished,
	latestLastmod,
	renderUrlSet,
	xmlResponse,
	getTaxonomyTerms,
	categoryPath,
	type SitemapUrl,
} from "../lib/sitemap";

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
	const origin = url.origin;

	// Approximate category lastmod with the newest published post overall (Rank Math
	// uses the newest post per category; per-term queries are deferred for scale).
	const lastmod = latestLastmod(await getAllPublished("posts"));

	const terms = await getTaxonomyTerms("category");
	const urls: SitemapUrl[] = (terms || [])
		.filter((t: any) => t.slug)
		.map((t: any) => ({ loc: `${origin}${categoryPath(t.locale, t.slug)}`, lastmod }));

	return xmlResponse(renderUrlSet(urls));
};
