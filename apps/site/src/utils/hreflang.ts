import { getTranslations } from "emdash";

import { contentPath } from "./content-url";

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
			locale: translation.locale || "en",
			slug: translation.slug || "",
			status: translation.status,
		}));

	const translations = ensureCurrent(published, current);
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
