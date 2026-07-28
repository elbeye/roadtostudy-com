// Typed façade over the redirect data, applied in src/middleware.ts on EVERY request
// BEFORE routing — Rank Math fired its redirects early too, so this reproduces the
// source ordering.
//
// The rules and the matcher itself live in ./redirects-data.mjs, a plain-data module, so
// that scripts/wp-crawl-verify.mjs (plain Node, cannot import TypeScript) checks exactly
// the same table the site serves. Add rules THERE, not here. Two tiers, exact first:
//
//   1. exact-path rules — generated WP attachment redirects, the Rank Math CSV export,
//      and category slug aliases.
//   2. structural patterns — /page/N/, /author/{slug}/, …/feed/.
//
// Because these run before routing, a rule whose `from` equals a path that still
// resolves to live content WILL shadow that content. ./redirects.test.ts pins that
// invariant against the live route shapes.

import { matchRedirectPath, REDIRECTS as REDIRECT_DATA } from "./redirects-data.mjs";

export type RedirectStatus = 301 | 302 | 410;
// `to` is absent only on a 410 ("gone") rule — there is nowhere to send the request.
export type RedirectRule = { from: string; to?: string; status: RedirectStatus };

export const REDIRECTS: RedirectRule[] = REDIRECT_DATA;

export function matchRedirect(pathname: string): { to?: string; status: RedirectStatus } | null {
	return matchRedirectPath(pathname);
}
