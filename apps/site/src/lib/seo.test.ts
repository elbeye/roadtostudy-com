import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_ROBOTS, NOINDEX_ROBOTS } from "./seo.ts";

// The indexable directive is SEO parity, not style: the source Rank Math install
// emitted this exact string on every indexable page, and the migrated pages emit
// their own `source_seo.robots` verbatim. If the shared constant drifts, the
// hand-built routes (home, /posts, /search) stop matching the migrated corpus and
// nothing else in the suite would notice.
test("DEFAULT_ROBOTS matches the Rank Math directive verbatim", () => {
	assert.equal(
		DEFAULT_ROBOTS,
		"follow, index, max-snippet:-1, max-video-preview:-1, max-image-preview:large",
	);
});

test("NOINDEX_ROBOTS keeps links crawlable", () => {
	assert.equal(NOINDEX_ROBOTS, "noindex, follow");
	// `follow` matters: these pages (search results, the /posts cursor tail) are how
	// Googlebot reaches deep posts. `noindex, nofollow` would strand them.
	assert.match(NOINDEX_ROBOTS, /(^|,\s*)follow\b/);
	assert.doesNotMatch(NOINDEX_ROBOTS, /nofollow/);
});

test("the two directives never both claim indexability", () => {
	assert.match(DEFAULT_ROBOTS, /(^|,\s*)index\b/);
	assert.match(NOINDEX_ROBOTS, /(^|,\s*)noindex\b/);
});
