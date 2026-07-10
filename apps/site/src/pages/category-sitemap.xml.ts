import type { APIRoute } from "astro";

import {
	getPublishedStats,
	renderUrlSet,
	xmlResponse,
	getTaxonomyTerms,
	categoryHasPosts,
	categoryPath,
	type SitemapUrl,
} from "../lib/sitemap";

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
	const origin = url.origin;

	// Approximate category lastmod with the newest published post overall (Rank Math
	// uses the newest post per category; per-term queries are deferred for scale).
	const { lastmod } = await getPublishedStats("posts");

	const terms = (await getTaxonomyTerms("category")) || [];
	// Rank Math only lists categories that have posts; drop empty terms so they don't
	// surface thin, zero-post archive pages in the sitemap.
	const withPosts = await Promise.all(
		terms
			.filter((t: any) => t.slug)
			.map(async (t: any) => ((await categoryHasPosts(t.slug, t.locale)) ? t : null)),
	);
	const urls: SitemapUrl[] = withPosts
		.filter((t): t is any => t !== null)
		.map((t: any) => ({ loc: `${origin}${categoryPath(t.locale, t.slug)}`, lastmod }));

	return xmlResponse(renderUrlSet(urls));
};
