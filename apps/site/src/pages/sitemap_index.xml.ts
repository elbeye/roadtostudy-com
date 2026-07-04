import type { APIRoute } from "astro";

import {
	getPublishedStats,
	renderSitemapIndex,
	xmlResponse,
	pageCount,
	type SitemapUrl,
} from "../lib/sitemap";

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
	const origin = url.origin;
	const [posts, pages] = await Promise.all([getPublishedStats("posts"), getPublishedStats("pages")]);

	const sitemaps: SitemapUrl[] = [];
	for (let i = 1; i <= pageCount(posts.count); i++) {
		sitemaps.push({ loc: `${origin}/post-sitemap${i}.xml`, lastmod: posts.lastmod });
	}
	for (let i = 1; i <= pageCount(pages.count); i++) {
		sitemaps.push({ loc: `${origin}/page-sitemap${i}.xml`, lastmod: pages.lastmod });
	}
	sitemaps.push({ loc: `${origin}/category-sitemap.xml`, lastmod: posts.lastmod });

	return xmlResponse(renderSitemapIndex(sitemaps));
};
