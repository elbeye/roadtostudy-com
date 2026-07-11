import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeXml, parseLocs, sitemapType, mapToTarget, classifyResult } from "./wp-crawl-verify.mjs";
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

// Rules are passed explicitly: the live table (src/lib/redirects-data.mjs) may be
// empty or mid-population, so tests never depend on its contents.
const RULES = [{ from: "/eski-yazi/", to: "/yeni-yazi/", status: 301 }];

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
	// empty rule table (the pre-extraction state) is a no-op: every redirect is uncovered
	assert.equal(classifyResult("https://t.dev/eski-yazi/", 301, "/yeni-yazi/", []), "redirect");
});

test("normalizePath percent-decodes so encoded rule sources match", () => {
	assert.equal(normalizePath("/a%20b/"), "/a b");
	assert.equal(normalizePath("/%EE%80%80koc%EE%80%81-universitesi"), "/koc-universitesi");
	// malformed escapes fall back to the raw pathname
	assert.equal(normalizePath("/bad%zz/"), "/bad%zz");
});

test("classifyResult ignores to-less (410) rules when matching expected redirects", () => {
	const rules = [{ from: "/gone/", status: 410 }];
	assert.equal(classifyResult("https://t.example/gone/", 301, "/x/", rules), "redirect");
});
