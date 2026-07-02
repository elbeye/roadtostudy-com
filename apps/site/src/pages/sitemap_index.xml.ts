import type { APIRoute } from "astro";

import {
	getAllPublished,
	latestLastmod,
	renderSitemapIndex,
	xmlResponse,
	pageCount,
	type SitemapUrl,
} from "../lib/sitemap";

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
	const origin = url.origin;
	const posts = await getAllPublished("posts");
	const pages = await getAllPublished("pages");

	const sitemaps: SitemapUrl[] = [];
	const postLastmod = latestLastmod(posts);
	for (let i = 1; i <= pageCount(posts.length); i++) {
		sitemaps.push({ loc: `${origin}/post-sitemap${i}.xml`, lastmod: postLastmod });
	}
	const pageLastmod = latestLastmod(pages);
	for (let i = 1; i <= pageCount(pages.length); i++) {
		sitemaps.push({ loc: `${origin}/page-sitemap${i}.xml`, lastmod: pageLastmod });
	}
	sitemaps.push({ loc: `${origin}/category-sitemap.xml`, lastmod: postLastmod });

	return xmlResponse(renderSitemapIndex(sitemaps));
};
