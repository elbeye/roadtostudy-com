// Redirect layer, applied in src/middleware.ts on EVERY request BEFORE routing
// (Rank Math fires its redirects early too). Two tiers:
//
//   1. REDIRECTS — exact-path Rank Math Redirections parity (spec §6.2). One entry
//      per extracted source rule. Populated during the full migration (spec §7 —
//      still pending), so it starts EMPTY. Because these run before routing, a rule
//      whose `from` equals a path that still resolves to live content WILL shadow
//      that content — when populating, verify each `from` does not collide with a
//      live URL (post/page/category/tag/home).
//
//   2. STRUCTURAL — pattern rules for WordPress URL families the new site does not
//      reproduce as live routes but that the source served 200 and are linked from
//      content + JSON-LD, so they must 301 rather than 404:
//        /page/N/ and /{locale}/page/N/     → home           (WP home archive pagination)
//        /author/{slug}/ (+ locale)         → home           (no author archives here)
//        …/feed/ (root, locale, comments, per-post) → /rss.xml (single consolidated feed)
//      Category pagination (/category/{slug}/page/N/) is a LIVE route and is
//      deliberately NOT matched here (the /page/N/ rule is anchored to the start).
//
// `from`/`to` are absolute site paths (leading slash). Exact matching is tolerant of
// a trailing-slash difference (WordPress canonical paths keep the trailing slash).
//
// Example once extracted:
//   { from: "/old-slug/", to: "/new-slug/", status: 301 },

export type RedirectRule = { from: string; to: string; status: 301 | 302 };

export const REDIRECTS: RedirectRule[] = [];

function normalize(pathname: string): string {
	// Compare on a trailing-slash-insensitive key so "/x" and "/x/" match the same
	// rule. Root ("/") is left as-is.
	if (pathname.length > 1 && pathname.endsWith("/")) return pathname.slice(0, -1);
	return pathname;
}

const RULES_BY_PATH = new Map<string, RedirectRule>(REDIRECTS.map((rule) => [normalize(rule.from), rule]));

// Optional locale prefix (en/fr/id); TR is unprefixed. Capture group 1 is the locale.
const LOCALE_PREFIX = "(?:(en|fr|id)/)?";
const localeHome = (locale: string | undefined) => (locale ? `/${locale}/` : "/");

const STRUCTURAL_REDIRECTS: Array<{ re: RegExp; to: (m: RegExpMatchArray) => string }> = [
	// WP home archive pagination → home. Anchored so /category/{slug}/page/N/ (a live
	// route) never matches.
	{ re: new RegExp(`^/${LOCALE_PREFIX}page/\\d+/?$`), to: (m) => localeHome(m[1]) },
	// Author archives (not reproduced) → home. Also rescues the Person @id in migrated
	// JSON-LD, which points at /author/{slug}/.
	{ re: new RegExp(`^/${LOCALE_PREFIX}author/[^/]+/?$`), to: (m) => localeHome(m[1]) },
	// Any WordPress feed endpoint (/feed/, /{locale}/feed/, /comments/feed/, per-post
	// /{slug}/feed/) → the single consolidated feed.
	{ re: /\/feed\/?$/, to: () => "/rss.xml" },
];

export function matchRedirect(pathname: string): { to: string; status: 301 | 302 } | null {
	const rule = RULES_BY_PATH.get(normalize(pathname));
	if (rule) return { to: rule.to, status: rule.status };
	for (const structural of STRUCTURAL_REDIRECTS) {
		const m = pathname.match(structural.re);
		if (m) return { to: structural.to(m), status: 301 };
	}
	return null;
}
