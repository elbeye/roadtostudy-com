import { getTranslations } from "emdash";

import { contentPath } from "./content-url";

type Alternate = { hreflang: string; href: string };
type TranslationSummary = {
	locale: string;
	slug: string;
	status?: string;
};

const LOCALE_ORDER = ["en", "tr", "fr", "id"];

// Language-home cluster (§6.5). TR is the unprefixed root (/), other locales are
// /{locale}/. x-default points at EN. Shared by index.astro (TR home) and the
// catch-all's locale homes so every home in the cluster emits the SAME reciprocal
// set — a home that omitted it would leave the others' annotations non-reciprocal
// and Google would drop them.
const HOME_LOCALE_ORDER = ["en", "tr", "fr", "id"] as const;

export const homeLocalePath = (locale: string) => (locale === "tr" ? "/" : `/${locale}/`);

export function getHomeAlternates(origin: string): Alternate[] {
	return [
		...HOME_LOCALE_ORDER.map((locale) => ({ hreflang: locale, href: `${origin}${homeLocalePath(locale)}` })),
		{ hreflang: "x-default", href: `${origin}${homeLocalePath("en")}` },
	];
}

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
