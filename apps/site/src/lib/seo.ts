/**
 * Robots directives shared by every route that emits its own head.
 *
 * These live here rather than in one route file because four routes need them and
 * the indexable string is parity-critical: Rank Math emitted it verbatim on every
 * indexable page of the source site, so a drift in one copy is an SEO regression
 * that nothing else would catch.
 */

/** Rank Math's directive for an indexable page. Must stay byte-identical (§6.3). */
export const DEFAULT_ROBOTS =
	"follow, index, max-snippet:-1, max-video-preview:-1, max-image-preview:large";

/**
 * For pages that must stay out of the index but should still pass link equity:
 * `/search` results and the keyset-paginated tail of `/posts`.
 *
 * Deliberately *not* paired with a robots.txt `Disallow` — a blocked URL is one
 * Google never fetches, so it never reads the noindex and the URL can linger in
 * the index on external signals alone. Crawlable + noindex is what actually
 * removes them.
 */
export const NOINDEX_ROBOTS = "noindex, follow";
