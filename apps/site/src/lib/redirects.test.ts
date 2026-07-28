import { test } from "node:test";
import assert from "node:assert/strict";
import { matchRedirect, REDIRECTS } from "./redirects.ts";
import { normalizePath } from "./redirects-data.mjs";

// The live route shapes this redirect layer must never shadow. Every one of these is a
// path that resolves to real content, and because the layer runs BEFORE routing, an
// exact rule matching any of them would take the page off the site. Verified 200 against
// the production origin on 2026-07-28.
const LIVE_PATHS = [
	"/",
	"/en/",
	"/fr/",
	"/id/",
	"/posts",
	"/search",
	"/rss.xml",
	"/robots.txt",
	"/sitemap_index.xml",
	"/category/akademik-destek-ve-basari/",
	"/category/burslar-ve-finansman/",
	"/category/dil-ogrenimi/",
	"/category/kariyer-ve-staj/",
	"/category/kulturel-adaptasyon/",
	"/category/saglik-ve-guvenlik/",
	"/category/vize-ve-gocmenlik/",
	"/category/yasam-maliyeti-ve-konaklama/",
	"/category/ogrenci-hayati-ve-seyahat/",
	"/category/universite-ve-programlar/",
	// Archive pagination is a live route; the structural /page/N/ rule must not reach it.
	"/category/burslar-ve-finansman/page/2/",
	"/en/category/university-and-programs/page/2/",
	"/tag/burs/page/2/",
];

test("no rule shadows a live route", () => {
	for (const path of LIVE_PATHS) {
		assert.equal(matchRedirect(path), null, `${path} must not match a redirect rule`);
	}
});

test("category slug aliases 301 to the renamed term, per locale", () => {
	assert.deepEqual(matchRedirect("/category/universiteler/"), { to: "/category/universite-ve-programlar/", status: 301 });
	assert.deepEqual(matchRedirect("/en/category/universities/"), { to: "/en/category/university-and-programs/", status: 301 });
	assert.deepEqual(matchRedirect("/fr/category/universites/"), { to: "/fr/category/universite-et-programmes/", status: 301 });
	assert.deepEqual(matchRedirect("/id/category/universitas/"), { to: "/id/category/universitas-dan-program/", status: 301 });
});

test("matching is trailing-slash insensitive both ways", () => {
	assert.deepEqual(matchRedirect("/category/universiteler"), matchRedirect("/category/universiteler/"));
	// The export stores this one without a trailing slash; a browser may send either.
	assert.ok(matchRedirect("/turkiye-ogrenci-vizesi-basvuru-sureci"));
	assert.ok(matchRedirect("/turkiye-ogrenci-vizesi-basvuru-sureci/"));
});

test("percent-encoded requests match rules whose source has literal spaces", () => {
	const raw = "/en/costs-of-moving-house-in-turkey/_wp_link_placeholder";
	assert.deepEqual(matchRedirect(raw), { to: "/en/costs-of-moving-house-in-turkey/", status: 301 });
	// Browsers percent-encode the space in this export rule's path.
	const encoded = "/en/entering-turkey-with-a-student-visa-airport-procedures/When%20you%20arrive%20at%20the%20airport-first-steps";
	assert.deepEqual(matchRedirect(encoded), { to: "/en/entering-turkey-with-a-student-visa-airport/", status: 301 });
});

test("a Rank Math gone rule yields 410 with no destination", () => {
	const hit = matchRedirect("/2025/01/14/work-permit-and-internship-visa-applications-while-studying-in-turkey-a-complete-guide/");
	assert.equal(hit?.status, 410);
	assert.equal(hit?.to, undefined);
});

// The export block sits after the generated attachment block precisely so it wins. If a
// regeneration ever re-sorts the file into one block, this flips silently — hence the pin.
test("an export rule overrides the generated attachment default for the same path", () => {
	assert.deepEqual(matchRedirect("/istanbul-universitesi/"), { to: "/istanbul-universitesi-2/", status: 301 });
});

test("structural: WP home pagination goes to the home of its own locale", () => {
	assert.deepEqual(matchRedirect("/page/2/"), { to: "/", status: 301 });
	assert.deepEqual(matchRedirect("/page/17"), { to: "/", status: 301 });
	assert.deepEqual(matchRedirect("/en/page/3/"), { to: "/en/", status: 301 });
	assert.deepEqual(matchRedirect("/fr/page/3/"), { to: "/fr/", status: 301 });
	assert.deepEqual(matchRedirect("/id/page/3/"), { to: "/id/", status: 301 });
});

test("structural: author archives go home, feeds go to the one feed", () => {
	assert.deepEqual(matchRedirect("/author/admin/"), { to: "/", status: 301 });
	assert.deepEqual(matchRedirect("/en/author/admin"), { to: "/en/", status: 301 });
	assert.deepEqual(matchRedirect("/feed/"), { to: "/rss.xml", status: 301 });
	assert.deepEqual(matchRedirect("/en/feed/"), { to: "/rss.xml", status: 301 });
	assert.deepEqual(matchRedirect("/comments/feed/"), { to: "/rss.xml", status: 301 });
	assert.deepEqual(matchRedirect("/some-post-slug/feed/"), { to: "/rss.xml", status: 301 });
});

test("an exact export rule wins over a structural pattern it overlaps", () => {
	// This path ends in a feed segment plus junk, and the export sends it to a real post
	// rather than to /rss.xml.
	assert.deepEqual(matchRedirect("/en/feed/When you arrive at the airport-first-steps"), {
		to: "/en/student-visa-preparations-checklist/",
		status: 301,
	});
});

test("table invariants: no self-redirect, no chain, no missing destination", () => {
	const byFrom = new Map(REDIRECTS.map((r) => [normalizePath(r.from), r]));
	for (const rule of REDIRECTS) {
		const from = normalizePath(rule.from);
		if (rule.status === 410) {
			assert.equal(rule.to, undefined, `410 rule ${from} must not carry a destination`);
			continue;
		}
		assert.ok(rule.to, `rule ${from} has no destination`);
		assert.notEqual(normalizePath(rule.to!), from, `rule ${from} redirects to itself`);
		// A chain costs a round trip and dilutes the signal to search engines; point at
		// the final destination instead.
		assert.equal(byFrom.has(normalizePath(rule.to!)), false, `rule ${from} -> ${rule.to} chains into another rule`);
	}
});

test("unmatched paths return null so the catch-all can resolve them", () => {
	assert.equal(matchRedirect("/some-live-post-slug/"), null);
	assert.equal(matchRedirect("/en/some-live-post-slug/"), null);
	assert.equal(matchRedirect("/tag/burs/"), null);
});
