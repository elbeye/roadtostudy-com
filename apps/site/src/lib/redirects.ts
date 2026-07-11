// Rank Math Redirections parity (spec §6.2). The rule table itself lives in
// ./redirects-data.mjs (plain data, shared with scripts/wp-crawl-verify.mjs) —
// add extracted rules THERE. This module keeps the typed matcher API and stays a
// safe no-op while the table is empty.
//
// Only wired into the catch-all's not-found path, so a rule never shadows a URL that
// still resolves to live content — it only rescues old URLs that would 404.

import { REDIRECTS as REDIRECT_DATA, normalizePath } from "./redirects-data.mjs";

export type RedirectRule = { from: string; to: string; status: 301 | 302 };

export const REDIRECTS: RedirectRule[] = REDIRECT_DATA;

const RULES_BY_PATH = new Map<string, RedirectRule>(REDIRECTS.map((rule) => [normalizePath(rule.from), rule]));

export function matchRedirect(pathname: string): { to: string; status: 301 | 302 } | null {
	const rule = RULES_BY_PATH.get(normalizePath(pathname));
	return rule ? { to: rule.to, status: rule.status } : null;
}
