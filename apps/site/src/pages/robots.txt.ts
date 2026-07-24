import type { APIRoute } from "astro";

// Site-owned robots rules + sitemap pointer (§6.7). For GEO/answer-engine
// discoverability, public content is explicitly open to search and AI retrieval bots
// while the EmDash admin remains closed.
export const prerender = false;

const GEO_USER_AGENTS = [
	"OAI-SearchBot",
	"GPTBot",
	"ChatGPT-User",
	"ClaudeBot",
	"Claude-SearchBot",
	"Claude-User",
	"PerplexityBot",
	"Perplexity-User",
	"Google-Extended",
	"Googlebot",
	"Googlebot-Image",
	"GoogleOther",
	"bingbot",
];

function renderRules(userAgent: string) {
	return `User-agent: ${userAgent}
Allow: /
Disallow: /_emdash/
Allow: /_emdash/api/media/
`;
}

export const GET: APIRoute = ({ url }) => {
	const origin = url.origin;
	const body = `# Public guide content is available for search, AI retrieval, and cited answer engines.
# Machine-readable AI discovery: ${origin}/llms.txt
# Do not enable Cloudflare Managed Content AI-crawler blocks for this zone unless the content policy changes.
${GEO_USER_AGENTS.map(renderRules).join("\n")}
User-agent: *
Allow: /
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
