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

// All content locales. getTaxonomyTerms is locale-aware and falls back to the default
// locale (tr) when none is passed, so the category terms must be gathered per locale —
// otherwise only the TR category archives land in the sitemap.
const LOCALES = ["tr", "en", "fr", "id"];

export const GET: APIRoute = async ({ url }) => {
	const origin = url.origin;

	// Approximate category lastmod with the newest published post overall (Rank Math
	// uses the newest post per category; per-term queries are deferred for scale).
	const { lastmod } = await getPublishedStats("posts");

	const termsByLocale = await Promise.all(
		LOCALES.map(async (locale) => ({ locale, terms: (await getTaxonomyTerms("category", { locale })) || [] })),
	);

	// Rank Math only lists categories that have posts; drop empty terms so they don't
	// surface thin, zero-post archive pages in the sitemap.
	const checked = await Promise.all(
		termsByLocale.flatMap(({ locale, terms }) =>
			terms
				.filter((t: any) => t.slug)
				.map(async (t: any) => ((await categoryHasPosts(t.slug, locale)) ? { locale, slug: t.slug } : null)),
		),
	);
	const urls: SitemapUrl[] = checked
		.filter((t): t is { locale: string; slug: string } => t !== null)
		.map((t) => ({ loc: `${origin}${categoryPath(t.locale, t.slug)}`, lastmod }));

	return xmlResponse(renderUrlSet(urls));
};
