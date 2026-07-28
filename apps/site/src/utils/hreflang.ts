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

// Language alternates for a taxonomy archive (/category/, /tag/). Sibling-locale
// terms are found via the shared translationGroup, so /category/university-and-programs/
// (EN) links to /category/universite-ve-programlar/ (TR) and vice versa. Returns []
// when the term has no translations, so the switcher/hreflang simply don't render.
export async function taxonomyAlternates(
	taxonomyName: "category" | "tag",
	term: { translationGroup?: string | null; locale: string; slug: string },
	origin: string,
): Promise<Alternate[]> {
	const bySlug = new Map<string, string>();
	bySlug.set(term.locale, term.slug);

	const group = term.translationGroup;
	if (group) {
		const perLocale = await Promise.all(
			LOCALE_ORDER.map((locale) => getTaxonomyTerms(taxonomyName, { locale })),
		);
		for (const terms of perLocale) {
			for (const candidate of terms) {
				if (candidate.translationGroup === group && candidate.slug) {
					bySlug.set(candidate.locale, candidate.slug);
				}
			}
		}
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
