import { defineMiddleware } from "astro:middleware";

import { matchRedirect } from "./lib/redirects";

// Rank Math Redirections parity (spec §6.2). Runs before routing so a migrated
// 301/302 fires exactly as it did on WordPress — before any content resolution,
// matching Rank Math's early-redirect behaviour. The rule table (src/lib/redirects.ts)
// is empty until the source rules are extracted, so today this is a pure passthrough
// and never touches admin (/_emdash), media, or any live URL.
export const onRequest = defineMiddleware((context, next) => {
	const hit = matchRedirect(context.url.pathname);
	// 410 replicates a Rank Math "gone" rule — the URL is intentionally dead.
	if (hit) return hit.status === 410 || !hit.to ? new Response("Gone", { status: 410 }) : context.redirect(hit.to, hit.status);
	return next();
});
