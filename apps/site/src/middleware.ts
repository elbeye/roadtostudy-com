import { defineMiddleware } from "astro:middleware";

import { matchRedirect } from "./lib/redirects";

// Redirect layer (spec §6.2). Runs before routing so a migrated 301/302/410 — or a
// structural WP redirect (/page/N/, /author/*, /feed/) — fires exactly as it did on
// WordPress, before any content resolution. See src/lib/redirects.ts for the rules.
//
// The 404 route and admin/API (/_emdash) are exempt and must stay exempt. Exempting
// /404 is not cosmetic: the catch-all renders unresolved paths through it, which re-runs
// this middleware for /404, so a rule matching /404 would turn every not-found into a
// redirect loop.
export const onRequest = defineMiddleware((context, next) => {
	const { pathname } = context.url;
	if (pathname === "/404" || pathname.startsWith("/_emdash")) return next();
	const hit = matchRedirect(pathname);
	if (!hit) return next();
	// 410 replicates a Rank Math "gone" rule: the URL is intentionally dead. Saying so
	// beats a 404 (which invites recrawls) and beats a 301 to an unrelated page.
	if (hit.status === 410 || !hit.to) return new Response("Gone", { status: 410 });
	return context.redirect(hit.to, hit.status);
});
