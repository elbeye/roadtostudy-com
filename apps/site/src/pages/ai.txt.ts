import type { APIRoute } from "astro";
import { getSiteSettings } from "emdash";

import { resolveBlogSiteIdentity } from "../utils/site-identity";

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
	const origin = url.origin;
	const { siteTitle, siteTagline } = resolveBlogSiteIdentity(await getSiteSettings());
	const body = `# AI Content Policy

Site: ${siteTitle}
Summary: ${siteTagline}

Allowed:
- Search indexing, retrieval-augmented generation, answer snippets, summaries, and short quotations with attribution.
- User-requested fetching by AI assistants when the response links back to the canonical RoadToStudy page.
- Translation or paraphrase for direct user answers when RoadToStudy is cited as the source.

Not Allowed:
- Access to /_emdash/ administration routes.
- Republishing full articles, bulk content extraction, or removal of attribution.
- Circumventing robots.txt, rate limits, authentication, or Cloudflare security controls.

Preferred Discovery:
- ${origin}/llms.txt
- ${origin}/sitemap_index.xml
- ${origin}/rss.xml
- ${origin}/robots.txt
`;

	return new Response(body, {
		headers: {
			"Content-Type": "text/plain; charset=utf-8",
			"Cache-Control": "public, max-age=3600",
		},
	});
};
