export function contentPath(locale: string | null | undefined, slug: string | null | undefined) {
	const cleanSlug = slug || "";
	if (!cleanSlug) return "/";
	return locale && locale !== "tr" ? `/${locale}/${cleanSlug}/` : `/${cleanSlug}/`;
}

export function categoryPath(locale: string | null | undefined, slug: string | null | undefined) {
	const cleanSlug = slug || "";
	if (!cleanSlug) return "/category/";
	return locale && locale !== "tr" ? `/${locale}/category/${cleanSlug}/` : `/category/${cleanSlug}/`;
}
