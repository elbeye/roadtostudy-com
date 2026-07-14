import { defineMiddleware } from "astro:middleware";

import { matchRedirect } from "./lib/redirects";

// Redirect layer (spec §6.2). Runs before routing so a migrated 301/302 — or a
// structural WP redirect (/page/N/, /author/*, /feed/) — fires exactly as it did on
// WordPress, before any content resolution. See src/lib/redirects.ts for the rules.
//
// The 404 route and admin/API (/_emdash) are exempt: never redirect them. Exempting
// /404 also matters because Astro.rewrite("/404") (used by the catch-all for
// unresolved paths) re-runs this middleware for /404 — a redirect rule matching /404
// would otherwise turn every not-found render into a redirect loop.
export const onRequest = defineMiddleware((context, next) => {
	const { pathname } = context.url;
	if (pathname === "/404" || pathname.startsWith("/_emdash")) return next();
	const hit = matchRedirect(pathname);
	if (hit) return context.redirect(hit.to, hit.status);
	return next();
});
