import type { APIRoute } from "astro";

import {
	entryLastmod,
	entryUrl,
	getPublishedSitemapEntries,
	isoLastmod,
	renderUrlSet,
	xmlResponse,
	type SitemapUrl,
} from "../lib/sitemap";

export const prerender = false;

export const GET: APIRoute = async ({ url, params }) => {
	const origin = url.origin;
	const page = Number(params.page) || 1;
	const pages = await getPublishedSitemapEntries("pages", page);
	if (pages.length === 0 && page !== 1) return new Response("Not Found", { status: 404 });

	const urls: SitemapUrl[] = pages.map((p) => ({
		loc: entryUrl(origin, p),
		lastmod: isoLastmod(entryLastmod(p)),
	}));
	return xmlResponse(renderUrlSet(urls));
};
