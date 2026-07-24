import type { APIRoute } from "astro";
import { getEmDashCollection, getSiteSettings, getTaxonomyTerms } from "emdash";

import { categoryPath, contentPath } from "../utils/content-url";
import { resolveBlogSiteIdentity } from "../utils/site-identity";

export const prerender = false;

const LOCALES = ["tr", "en", "fr", "id"] as const;
const LOCALE_LABELS: Record<(typeof LOCALES)[number], string> = {
	tr: "Turkish",
	en: "English",
	fr: "French",
	id: "Indonesian",
};

const localeHomePath = (locale: string) => (locale === "tr" ? "/" : `/${locale}/`);

function compactText(value: unknown, maxLength = 180) {
	if (typeof value !== "string") return "";
	const text = value.replace(/\s+/g, " ").trim();
	return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}...` : text;
}

function absoluteUrl(origin: string, path: string) {
	return `${origin}${path}`;
}

export const GET: APIRoute = async ({ url }) => {
	const origin = url.origin;
	const { siteTitle, siteTagline } = resolveBlogSiteIdentity(await getSiteSettings());

	const [{ entries: posts }, categoryGroups] = await Promise.all([
		getEmDashCollection("posts", {
			orderBy: { published_at: "desc" },
			limit: 60,
		}),
		Promise.all(
			LOCALES.map(async (locale) => ({
				locale,
				terms: ((await getTaxonomyTerms("category", { locale })) || []).filter((term: any) => term.slug),
			})),
		),
	]);

	const localeLines = LOCALES.map(
		(locale) => `- ${LOCALE_LABELS[locale]}: ${absoluteUrl(origin, localeHomePath(locale))}`,
	).join("\n");

	const categoryLines = categoryGroups
		.flatMap(({ locale, terms }) =>
			terms.slice(0, 12).map(
				(term: any) =>
					`- ${term.label} (${locale}): ${absoluteUrl(origin, categoryPath(locale, term.slug))}`,
			),
		)
		.join("\n");

	const postLines = posts
		.map((post: any) => {
			const locale = post.data.locale || "tr";
			const href = absoluteUrl(origin, contentPath(locale, post.data.slug || post.id));
			const excerpt = compactText(post.data.excerpt || post.data.source_seo?.description);
			return `- ${post.data.title || "Untitled"} (${locale}): ${href}${excerpt ? ` - ${excerpt}` : ""}`;
		})
		.join("\n");

	const body = `# ${siteTitle}

> ${siteTagline}

RoadToStudy publishes multilingual, student-focused guides about studying in Turkey: universities, scholarships, admissions, visas, Turkish language learning, student life, internships, and practical city guidance.

## AI Retrieval Policy

- Public guide pages may be crawled, summarized, quoted in short excerpts, and cited by search and answer engines.
- Always cite the canonical page URL when using RoadToStudy content.
- Do not access /_emdash/ admin routes or republish full articles without permission.
- Prefer canonical HTML pages, sitemap_index.xml, rss.xml, and this llms.txt file for discovery.

## Core URLs

- Homepage: ${origin}/
- Search: ${origin}/search
- Sitemap index: ${origin}/sitemap_index.xml
- RSS: ${origin}/rss.xml
- AI policy: ${origin}/ai.txt

## Language Hubs

${localeLines}

## Topic Hubs

${categoryLines || "- Topic hubs are available through sitemap_index.xml."}

## Recent Guides

${postLines || "- Recent guides are available through rss.xml and sitemap_index.xml."}
`;

	return new Response(body, {
		headers: {
			"Content-Type": "text/plain; charset=utf-8",
			"Cache-Control": "public, max-age=3600",
		},
	});
};
