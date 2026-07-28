import { getTaxonomyTerms, getTranslations } from "emdash";

import { contentPath, taxonomyPath } from "./content-url";

type Alternate = { hreflang: string; href: string };
type TranslationSummary = {
	locale: string;
	slug: string;
	status?: string;
};

const LOCALE_ORDER = ["en", "tr", "fr", "id"];

export async function contentAlternates(
	collection: string,
	id: string,
	origin: string,
	current: { locale: string; slug: string },
): Promise<Alternate[]> {
	const result = await getTranslations(collection, id);
	const published = (result.translations || [])
		.filter((translation) => translation.status === "published" && !!translation.slug)
		.map((translation) => ({
			// Unprefixed default locale is TR (astro.config.mjs), so a record with no
			// explicit locale is Turkish, not English.
			locale: translation.locale || "tr",
			slug: translation.slug || "",
			status: translation.status,
		}));

	const translations = ensureCurrent(published, current);
	if (dedupeLocales(translations).length < 2) return [];

	const alternates = sortByLocale(translations).map((translation) => ({
		hreflang: translation.locale,
		href: `${origin}${contentPath(translation.locale, translation.slug)}`,
	}));

	const xDefault = translations.find((translation) => translation.locale === "en") ||
		translations.find((translation) => translation.locale === current.locale);
	if (xDefault) {
		alternates.push({
			hreflang: "x-default",
			href: `${origin}${contentPath(xDefault.locale, xDefault.slug)}`,
		});
	}

	return dedupeAlternates(alternates);
}

type TermRef = { translationGroup?: string | null; locale: string; slug: string; children?: TermRef[] };

// getTaxonomyTerms has no "skip counts" option, so each call also runs a full
// count aggregate over content_taxonomies — 4 locales per archive render, on a table
// with a row per post. Nothing caches it either (the object cache is inert without an
// explicit backend in astro.config.mjs), so this memoizes the slug map per isolate.
// Terms change far less often than archives are served; a rename is visible after at
// most SLUG_MAP_TTL_MS, and invalidateTermCache() does not reach this map.
const SLUG_MAP_TTL_MS = 5 * 60 * 1000;
const slugMapCache = new Map<string, { at: number; groups: Map<string, Map<string, string>> }>();

// Terms come back as a tree when the taxonomy is hierarchical (category is), so a
// nested term lives under .children and would otherwise be invisible here.
function flattenTerms(terms: TermRef[]): TermRef[] {
	return terms.flatMap((term) => [term, ...flattenTerms(term.children ?? [])]);
}

async function slugsByGroup(taxonomyName: string, now: number) {
	const cached = slugMapCache.get(taxonomyName);
	if (cached && now - cached.at < SLUG_MAP_TTL_MS) return cached.groups;

	const perLocale = await Promise.all(
		LOCALE_ORDER.map((locale) => getTaxonomyTerms(taxonomyName, { locale })),
	);
	const groups = new Map<string, Map<string, string>>();
	for (const terms of perLocale) {
		for (const candidate of flattenTerms((terms ?? []) as TermRef[])) {
			if (!candidate.translationGroup || !candidate.slug) continue;
			const byLocale = groups.get(candidate.translationGroup) ?? new Map<string, string>();
			byLocale.set(candidate.locale, candidate.slug);
			groups.set(candidate.translationGroup, byLocale);
		}
	}
	slugMapCache.set(taxonomyName, { at: now, groups });
	return groups;
}

// Language alternates for a taxonomy archive (/category/, /tag/). Sibling-locale
// terms are found via the shared translationGroup, so /category/university-and-programs/
// (EN) links to /category/universite-ve-programlar/ (TR) and vice versa. Returns []
// when the term has no translations, so the switcher/hreflang simply don't render.
// The caller must pass the term actually rendered, whose locale matches the URL —
// otherwise the page's own URL would be missing from the cluster it advertises.
export async function taxonomyAlternates(
	taxonomyName: "category" | "tag",
	term: TermRef,
	origin: string,
	now: number = Date.now(),
): Promise<Alternate[]> {
	const bySlug = new Map<string, string>();
	bySlug.set(term.locale, term.slug);

	if (term.translationGroup) {
		const groups = await slugsByGroup(taxonomyName, now);
		for (const [locale, slug] of groups.get(term.translationGroup) ?? []) {
			bySlug.set(locale, slug);
		}
		// Never let a stale cache drop the current URL out of its own cluster.
		bySlug.set(term.locale, term.slug);
	}

	if (bySlug.size < 2) return [];

	const ordered = LOCALE_ORDER.filter((locale) => bySlug.has(locale));
	const alternates = ordered.map((locale) => ({
		hreflang: locale,
		href: `${origin}${taxonomyPath(taxonomyName, locale, bySlug.get(locale) as string)}`,
	}));
	const xDefault = bySlug.has("en") ? "en" : term.locale;
	alternates.push({
		hreflang: "x-default",
		href: `${origin}${taxonomyPath(taxonomyName, xDefault, bySlug.get(xDefault) as string)}`,
	});
	return dedupeAlternates(alternates);
}

function ensureCurrent(
	translations: TranslationSummary[],
	current: { locale: string; slug: string },
) {
	if (translations.some((translation) => translation.locale === current.locale)) {
		return translations;
	}
	return [...translations, { locale: current.locale, slug: current.slug, status: "published" }];
}

function sortByLocale(translations: TranslationSummary[]) {
	return [...translations].sort((a, b) => {
		const aIndex = LOCALE_ORDER.indexOf(a.locale);
		const bIndex = LOCALE_ORDER.indexOf(b.locale);
		return (aIndex === -1 ? 99 : aIndex) - (bIndex === -1 ? 99 : bIndex);
	});
}

function dedupeLocales(translations: TranslationSummary[]) {
	const seen = new Set<string>();
	return translations.filter((translation) => {
		if (seen.has(translation.locale)) return false;
		seen.add(translation.locale);
		return true;
	});
}

function dedupeAlternates(alternates: Alternate[]) {
	// One alternate per hreflang value (language + x-default). A translation group
	// with two members of the same locale would otherwise emit duplicate hreflang
	// tags with different hrefs, which is invalid.
	const seen = new Set<string>();
	return alternates.filter((alternate) => {
		if (seen.has(alternate.hreflang)) return false;
		seen.add(alternate.hreflang);
		return true;
	});
}
