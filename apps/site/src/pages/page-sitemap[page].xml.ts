import type { APIRoute } from "astro";

import {
	getAllPublished,
	entryLastmod,
	entryUrl,
	isoLastmod,
	renderUrlSet,
	xmlResponse,
	pageSlice,
	type SitemapUrl,
} from "../lib/sitemap";

export const prerender = false;

export const GET: APIRoute = async ({ url, params }) => {
	const origin = url.origin;
	const page = Number(params.page) || 1;
	const pages = await getAllPublished("pages");
	const slice = pageSlice(pages, page);
	if (slice.length === 0 && page !== 1) return new Response("Not Found", { status: 404 });

	const urls: SitemapUrl[] = slice.map((p) => ({
		loc: entryUrl(origin, p),
		lastmod: isoLastmod(entryLastmod(p)),
	}));
	return xmlResponse(renderUrlSet(urls));
};
