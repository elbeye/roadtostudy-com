import type { APIRoute } from "astro";

// Site-owned robots rules + sitemap pointer (§6.7). The source also served a
// Cloudflare "Managed Content" block (AI-crawler disallows: GPTBot, Google-Extended,
// meta-externalagent, …) which is injected by Cloudflare at the edge, not by the app —
// re-enable Cloudflare Managed Content on the new zone to preserve those. Admin is at
// /_emdash (not WordPress's /wp-admin), so that's what we disallow here.
export const prerender = false;

export const GET: APIRoute = ({ url }) => {
	const origin = url.origin;
	const body = `User-agent: *
Disallow: /_emdash/
Allow: /_emdash/api/media/

Sitemap: ${origin}/sitemap_index.xml
`;
	return new Response(body, {
		headers: {
			"Content-Type": "text/plain; charset=utf-8",
			"Cache-Control": "public, max-age=3600",
		},
	});
};
