import { test } from "node:test";
import assert from "node:assert/strict";
import { extractHrefs, classifyHref, auditExport } from "./wp-link-audit.mjs";

test("extractHrefs finds double- and single-quoted hrefs in document order, entity-decoded", () => {
	const html =
		'<p><a href="https://roadtostudy.com/a/?x=1&amp;y=2">a</a> ' +
		"<a href='/b/'>b</a> <a data-href=\"nope\">c</a> <img src=\"/img.png\"></p>";
	assert.deepEqual(extractHrefs(html), ["https://roadtostudy.com/a/?x=1&y=2", "/b/"]);
	assert.deepEqual(extractHrefs(""), []);
	assert.deepEqual(extractHrefs(null), []);
});

test("classifyHref flags stacked schemes and the internal doubled slash together", () => {
	assert.deepEqual(classifyHref("https://https://roadtostudy.com//pazarlar/"), [
		"stacked-scheme",
		"doubled-slash-path",
	]);
	assert.deepEqual(classifyHref("http://https://roadtostudy.com/x"), ["stacked-scheme"]);
	assert.deepEqual(classifyHref("https://roadtostudy.com//x/"), ["doubled-slash-path"]);
});

test("classifyHref flags whitespace and unparseable absolute URLs", () => {
	assert.ok(classifyHref("https://roadtostudy.com/some page/").includes("whitespace-in-url"));
	assert.ok(classifyHref("https://road study.com/").includes("unparseable"));
});

test("classifyHref passes valid internal, external, relative, and non-http hrefs", () => {
	for (const href of [
		"https://roadtostudy.com/turkiyede-universite/",
		"https://www.roadtostudy.com/en/guide/",
		"https://example.com//double-slash-is-their-business/",
		"/wp-content/uploads/x.jpg",
		"#faq",
		"mailto:hi@roadtostudy.com",
		"",
	]) {
		assert.deepEqual(classifyHref(href), [], href);
	}
});

test("auditExport reports offenders per item/field and confirms normalizeHref repairs them", () => {
	const source = {
		content: {
			posts: [
				{
					id: 1,
					slug: "broken",
					content: {
						rendered:
							'<p><a href="https://https://roadtostudy.com//a/">bad</a> <a href="https://roadtostudy.com/ok/">ok</a></p>',
						raw: '<p><a href="https://https://roadtostudy.com//a/">bad</a></p>',
					},
				},
				{ id: 2, slug: "clean", content: { rendered: '<p><a href="/fine/">fine</a></p>' } },
			],
			pages: [
				{ id: 3, slug: "page", content: { rendered: '<p><a href="https://roadtostudy.com//b/">bad</a></p>' } },
			],
		},
	};
	const { scanned, hrefsScanned, offenders, byType, unfixed } = auditExport(source);
	assert.deepEqual(scanned, { posts: 2, pages: 1 });
	assert.equal(hrefsScanned, 5);
	assert.deepEqual(
		offenders.map((o) => [o.collection, o.slug, o.field, o.fixed]),
		[
			["posts", "broken", "rendered", "https://roadtostudy.com/a/"],
			["posts", "broken", "raw", "https://roadtostudy.com/a/"],
			["pages", "page", "rendered", "https://roadtostudy.com/b/"],
		],
	);
	assert.deepEqual(byType, { "stacked-scheme": 2, "doubled-slash-path": 3 });
	assert.equal(unfixed.length, 0);
	assert.ok(offenders.every((o) => o.fixedIsClean));
});

test("auditExport on an export with no bodies is empty, not an error", () => {
	const { offenders, hrefsScanned } = auditExport({ content: { posts: [{ id: 1, slug: "x" }] } });
	assert.equal(hrefsScanned, 0);
	assert.deepEqual(offenders, []);
});
