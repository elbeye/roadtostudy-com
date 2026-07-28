export function contentPath(locale: string | null | undefined, slug: string | null | undefined) {
	const cleanSlug = slug || "";
	if (!cleanSlug) return "/";
	return locale && locale !== "tr" ? `/${locale}/${cleanSlug}/` : `/${cleanSlug}/`;
}

export function categoryPath(locale: string | null | undefined, slug: string | null | undefined) {
	return taxonomyPath("category", locale, slug);
}

// Archive URL for a taxonomy term. TR is unprefixed (/{tax}/{slug}/), other
// locales are /{locale}/{tax}/{slug}/ — the same scheme as content URLs.
export function taxonomyPath(
	taxonomy: "category" | "tag",
	locale: string | null | undefined,
	slug: string | null | undefined,
) {
	const cleanSlug = slug || "";
	if (!cleanSlug) return `/${taxonomy}/`;
	return locale && locale !== "tr"
		? `/${locale}/${taxonomy}/${cleanSlug}/`
		: `/${taxonomy}/${cleanSlug}/`;
}
