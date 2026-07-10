// Rank Math Redirections parity (spec §6.2). The source WordPress site's redirect
// rules (301/302) are extracted during the full migration (spec §7 — still pending),
// so this table starts EMPTY and the matcher is a safe no-op until it's populated.
//
// How to populate: add one entry per extracted rule. `from` and `to` are absolute
// site paths (leading slash). Matching is exact on the pathname, tolerant of a
// trailing-slash difference (WordPress canonical paths keep the trailing slash).
// Only wired into the catch-all's not-found path, so a rule never shadows a URL that
// still resolves to live content — it only rescues old URLs that would 404.
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

export function matchRedirect(pathname: string): { to: string; status: 301 | 302 } | null {
	const rule = RULES_BY_PATH.get(normalize(pathname));
	return rule ? { to: rule.to, status: rule.status } : null;
}
