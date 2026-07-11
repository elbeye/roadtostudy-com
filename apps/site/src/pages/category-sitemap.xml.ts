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

// The source Rank Math category sitemap lists only the 10 unprefixed TR category
// archives (verified against the live source's /category-sitemap.xml) — EN/FR/ID
// category archives are not in it. Match that exactly for parity: TR terms only.
// getTaxonomyTerms is locale-aware, so pass the locale explicitly rather than relying
// on the default-locale fallback.
const SITEMAP_LOCALE = "tr";

export const GET: APIRoute = async ({ url }) => {
	const origin = url.origin;

	// Approximate category lastmod with the newest published post overall (Rank Math
	// uses the newest post per category; per-term queries are deferred for scale).
	const { lastmod } = await getPublishedStats("posts");

	const terms = (await getTaxonomyTerms("category", { locale: SITEMAP_LOCALE })) || [];
	// Rank Math only lists categories that have posts; drop empty terms so they don't
	// surface thin, zero-post archive pages in the sitemap.
	const checked = await Promise.all(
		terms
			.filter((t: any) => t.slug)
			.map(async (t: any) => ((await categoryHasPosts(t.slug, SITEMAP_LOCALE)) ? t.slug : null)),
	);
	const urls: SitemapUrl[] = checked
		.filter((slug): slug is string => slug !== null)
		.map((slug) => ({ loc: `${origin}${categoryPath(SITEMAP_LOCALE, slug)}`, lastmod }));

	return xmlResponse(renderUrlSet(urls));
};
