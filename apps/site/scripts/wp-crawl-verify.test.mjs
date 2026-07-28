import { test } from "node:test";
import assert from "node:assert/strict";
import {
	archiveKey,
	classifyResult,
	decodeXml,
	expectedEmptySet,
	localizedArchivePaths,
	mapToTarget,
	normalizeArchivePath,
	parseArchiveCount,
	parseLocs,
	sitemapType,
} from "./wp-crawl-verify.mjs";
import { normalizePath } from "../src/lib/redirects-data.mjs";

test("parseLocs extracts and decodes every loc", () => {
	const xml = `<?xml version="1.0"?><urlset>
		<url><loc>https://roadtostudy.com/a-slug/</loc></url>
		<url><loc>https://roadtostudy.com/en/x?y=1&amp;z=2</loc></url>
		<url><loc>  https://roadtostudy.com/category/burslar-ve-finansman/  </loc></url>
	</urlset>`;
	assert.deepEqual(parseLocs(xml), [
		"https://roadtostudy.com/a-slug/",
		"https://roadtostudy.com/en/x?y=1&z=2",
		"https://roadtostudy.com/category/burslar-ve-finansman/",
	]);
});

test("parseLocs on empty/garbage yields []", () => {
	assert.deepEqual(parseLocs(""), []);
	assert.deepEqual(parseLocs(null), []);
	assert.deepEqual(parseLocs("<html>no locs</html>"), []);
});

test("decodeXml unescapes entities", () => {
	assert.equal(decodeXml("a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos;"), `a & b <c> "d" 'e'`);
});

test("sitemapType classifies by sub-sitemap name", () => {
	assert.equal(sitemapType("https://x/post-sitemap3.xml"), "post");
	assert.equal(sitemapType("https://x/page-sitemap1.xml"), "page");
	assert.equal(sitemapType("https://x/category-sitemap.xml"), "category");
	assert.equal(sitemapType("https://x/whatever.xml"), "other");
});

test("mapToTarget preserves path across origins", () => {
	assert.equal(
		mapToTarget("https://roadtostudy.com/en/foo/", "https://roadtostudy.com", "https://preview.workers.dev"),
		"https://preview.workers.dev/en/foo/",
	);
	// trailing slash on target base is normalized
	assert.equal(
		mapToTarget("https://roadtostudy.com/category/x/page/2/", "https://roadtostudy.com", "https://preview.workers.dev/"),
		"https://preview.workers.dev/category/x/page/2/",
	);
	// a URL on a different host still maps by pathname
	assert.equal(
		mapToTarget("https://www.roadtostudy.com/bar/", "https://roadtostudy.com", "https://t.dev"),
		"https://t.dev/bar/",
	);
});

// The content gate exists because an archive can return 200 and render nothing.
// These lock down the count parser against the real markup it has to read.
test("parseArchiveCount reads the rendered post count from real archive markup", () => {
	// Astro scopes with a data attribute, so the class stays bare — this is the live shape.
	assert.equal(parseArchiveCount('<p class="wp-excerpt" data-astro-cid-iwstzw75>85posts</p>'), 85);
	assert.equal(parseArchiveCount('<p class="wp-excerpt" data-astro-cid-iwstzw75>0posts</p>'), 0);
	assert.equal(parseArchiveCount('<p class="wp-excerpt" data-astro-cid-x>1 post</p>'), 1);
	assert.equal(parseArchiveCount('<p class="wp-excerpt">\n\t12 posts\n</p>'), 12);
});

// The counter is localized, and TR is the entire unprefixed corpus — an English-only
// parser would report every TR archive as unreadable and silently skip the content check.
test("parseArchiveCount reads the localized counter noun in all four locales", () => {
	assert.equal(parseArchiveCount('<p class="wp-excerpt" data-astro-cid-x>104 yazı</p>'), 104);
	assert.equal(parseArchiveCount('<p class="wp-excerpt" data-astro-cid-x>85 posts</p>'), 85);
	assert.equal(parseArchiveCount('<p class="wp-excerpt" data-astro-cid-x>7 articles</p>'), 7);
	assert.equal(parseArchiveCount('<p class="wp-excerpt" data-astro-cid-x>1 article</p>'), 1);
	assert.equal(parseArchiveCount('<p class="wp-excerpt" data-astro-cid-x>12 artikel</p>'), 12);
	// zero must still parse as 0 (a blocker), not as null (a warning)
	assert.equal(parseArchiveCount('<p class="wp-excerpt" data-astro-cid-x>0 yazı</p>'), 0);
});

test("parseArchiveCount returns null when the count is absent, never 0", () => {
	// null must stay distinct from 0: 0 fails the gate, null only warns.
	assert.equal(parseArchiveCount("<html>a post page</html>"), null);
	assert.equal(parseArchiveCount(""), null);
	assert.equal(parseArchiveCount(null), null);
	assert.notEqual(parseArchiveCount("<html>x</html>"), 0);
});

test("normalizeArchivePath yields a trailing-slashed path from a URL or path", () => {
	assert.equal(normalizeArchivePath("https://roadtostudy.com/fr/category/x/"), "/fr/category/x/");
	assert.equal(normalizeArchivePath("https://roadtostudy.com/fr/category/x"), "/fr/category/x/");
	assert.equal(normalizeArchivePath("/en/category/y/"), "/en/category/y/");
	assert.equal(normalizeArchivePath("en/category/y"), "/en/category/y/");
});

test("archiveKey strips a target base that carries a path prefix", () => {
	// Otherwise a preview deployment under /preview would turn the expected-empty
	// allowlist into hard blockers.
	assert.equal(
		archiveKey("https://t.dev/preview/en/category/x/", "https://t.dev/preview"),
		"/en/category/x/",
	);
	assert.equal(archiveKey("https://t.dev/en/category/x/", "https://t.dev"), "/en/category/x/");
	assert.equal(archiveKey("https://t.dev/en/category/x/", ""), "/en/category/x/");
});

test("list envs: unset/empty use defaults, 'none' clears, otherwise override", () => {
	assert.equal(localizedArchivePaths(undefined).length, 30);
	assert.equal(localizedArchivePaths("").length, 30);
	assert.equal(localizedArchivePaths("   ").length, 30);
	assert.deepEqual(localizedArchivePaths("none"), []);
	assert.deepEqual(localizedArchivePaths("NONE"), []);
	assert.deepEqual(localizedArchivePaths("/en/category/a, /fr/category/b"), [
		"/en/category/a/",
		"/fr/category/b/",
	]);

	assert.equal(expectedEmptySet(undefined).size, 6);
	assert.equal(expectedEmptySet("").size, 6);
	assert.equal(expectedEmptySet("none").size, 0);
	assert.deepEqual([...expectedEmptySet("/en/category/z")], ["/en/category/z/"]);
});

test("every expected-empty archive is one the crawler actually visits", () => {
	// A typo in the allowlist would silently exempt nothing (or the wrong URL).
	const visited = new Set(localizedArchivePaths(undefined));
	for (const path of expectedEmptySet(undefined)) {
		assert.ok(visited.has(path), `${path} is allow-listed but never crawled`);
	}
});

// The matcher is injected rather than reaching for the live table, so these assert
// classifyResult's logic instead of the current contents of redirects-data.mjs.
const match = (rules) => (pathname) => {
	const hit = rules.find((r) => normalizePath(r.from) === normalizePath(pathname));
	return hit ? { to: hit.to, status: hit.status } : null;
};
const RULES = match([{ from: "/eski-yazi/", to: "/yeni-yazi/", status: 301 }]);

test("classifyResult: 200 is ok, non-redirect non-200 is a blocker", () => {
	assert.equal(classifyResult("https://t.dev/eski-yazi/", 200, undefined, RULES), "ok");
	assert.equal(classifyResult("https://t.dev/eski-yazi/", 404, undefined, RULES), "blocker");
	assert.equal(classifyResult("https://t.dev/x/", 500, undefined, RULES), "blocker");
	assert.equal(classifyResult("https://t.dev/x/", 0, undefined, RULES), "blocker");
});

test("classifyResult: intentional redirect with matching Location passes", () => {
	// relative Location
	assert.equal(classifyResult("https://t.dev/eski-yazi/", 301, "/yeni-yazi/", RULES), "expected-redirect");
	// absolute Location on the target origin
	assert.equal(classifyResult("https://t.dev/eski-yazi/", 301, "https://t.dev/yeni-yazi/", RULES), "expected-redirect");
	// trailing-slash difference on either side is tolerated
	assert.equal(classifyResult("https://t.dev/eski-yazi", 308, "/yeni-yazi", RULES), "expected-redirect");
});

test("classifyResult: intentional redirect with wrong Location is a blocker (mismatch)", () => {
	assert.equal(classifyResult("https://t.dev/eski-yazi/", 301, "/baska-yere/", RULES), "redirect-mismatch");
	// a redirect with no Location header at all can't match the configured target
	assert.equal(classifyResult("https://t.dev/eski-yazi/", 301, undefined, RULES), "redirect-mismatch");
});

test("classifyResult: uncovered redirect stays the 'redirect' warning", () => {
	assert.equal(classifyResult("https://t.dev/bilinmeyen/", 301, "/nereye/", RULES), "redirect");
	assert.equal(classifyResult("https://t.dev/bilinmeyen/", 302, "/nereye/", RULES), "redirect");
	// an empty table is a no-op: every redirect is uncovered
	assert.equal(classifyResult("https://t.dev/eski-yazi/", 301, "/yeni-yazi/", match([])), "redirect");
});

test("classifyResult: 410 passes only where a gone rule says so", () => {
	const gone = match([{ from: "/gone/", status: 410 }]);
	assert.equal(classifyResult("https://t.dev/gone/", 410, undefined, gone), "expected-gone");
	// an unexplained 410 is a blocker — the site should not be dropping URLs on its own
	assert.equal(classifyResult("https://t.dev/other/", 410, undefined, gone), "blocker");
	// a to-less rule can never satisfy an expected *redirect*
	assert.equal(classifyResult("https://t.dev/gone/", 301, "/x/", gone), "redirect");
});

test("normalizePath percent-decodes so encoded rule sources match", () => {
	assert.equal(normalizePath("/a%20b/"), "/a b");
	assert.equal(normalizePath("/%EE%80%80koc%EE%80%81-universitesi"), "/koc-universitesi");
	// malformed escapes fall back to the raw pathname
	assert.equal(normalizePath("/bad%zz/"), "/bad%zz");
});
