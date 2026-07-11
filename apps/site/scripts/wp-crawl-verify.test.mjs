import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeXml, parseLocs, sitemapType, mapToTarget } from "./wp-crawl-verify.mjs";

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
