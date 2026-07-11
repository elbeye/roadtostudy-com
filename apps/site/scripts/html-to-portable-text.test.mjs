import { test } from "node:test";
import assert from "node:assert/strict";
import {
	htmlToPortableText,
	inlineToSpans,
	decodeHtml,
	isProseHref,
	normalizeHref,
	normalizeHtmlHrefs,
} from "./html-to-portable-text.mjs";

const text = (block) => block.children.map((c) => c.text).join("");

test("decodeHtml handles common WordPress entities", () => {
	assert.equal(decodeHtml("Tom&#8217;s &amp; Jerry &#8211; &quot;hi&quot;"), `Tom's & Jerry - "hi"`);
	assert.equal(decodeHtml("a&nbsp;b"), "a b");
});

test("headings map to capped styles and paragraphs to normal, in order", () => {
	const blocks = htmlToPortableText("<h2>Title</h2><p>Body one.</p><h5>Deep</h5><p>Body two.</p>");
	assert.deepEqual(
		blocks.map((b) => [b.style, text(b)]),
		[
			["h2", "Title"],
			["normal", "Body one."],
			["h4", "Deep"], // h5 capped to h4
			["normal", "Body two."],
		],
	);
});

test("unordered and ordered lists become listItem blocks", () => {
	const blocks = htmlToPortableText("<ul><li>alpha</li><li>beta</li></ul><ol><li>one</li></ol>");
	assert.deepEqual(
		blocks.map((b) => [b.listItem, b.level, text(b)]),
		[
			["bullet", 1, "alpha"],
			["bullet", 1, "beta"],
			["number", 1, "one"],
		],
	);
});

test("blockquote gets its own style", () => {
	const [b] = htmlToPortableText("<blockquote><p>quoted</p></blockquote>");
	assert.equal(b.style, "blockquote");
	assert.equal(text(b), "quoted");
});

test("links become markDefs referenced by span marks", () => {
	const [b] = htmlToPortableText('<p>See <a href="https://x.com/p">this</a> now.</p>');
	assert.equal(b.markDefs.length, 1);
	assert.equal(b.markDefs[0]._type, "link");
	assert.equal(b.markDefs[0].href, "https://x.com/p");
	const linked = b.children.find((c) => c.text === "this");
	assert.ok(linked.marks.includes(b.markDefs[0]._key));
	// surrounding text is unmarked
	assert.deepEqual(
		b.children.find((c) => c.text === "See ").marks,
		[],
	);
});

test("strong and em become decorators", () => {
	const { spans } = inlineToSpans("plain <strong>bold</strong> and <em>italic</em>", "b0");
	const bold = spans.find((s) => s.text === "bold");
	const italic = spans.find((s) => s.text === "italic");
	assert.deepEqual(bold.marks, ["strong"]);
	assert.deepEqual(italic.marks, ["em"]);
});

test("unknown tags are stripped but their text kept; br is a space", () => {
	const [b] = htmlToPortableText('<p>a<span class="x">b</span>c<br>d</p>');
	assert.equal(text(b), "abc d");
});

test("empty / whitespace-only blocks are dropped", () => {
	const blocks = htmlToPortableText("<p>   </p><p></p><p>real</p>");
	assert.equal(blocks.length, 1);
	assert.equal(text(blocks[0]), "real");
});

test("content with no block tags falls back to a single normal block", () => {
	const blocks = htmlToPortableText("just some bare text &amp; more");
	assert.equal(blocks.length, 1);
	assert.equal(blocks[0].style, "normal");
	assert.equal(text(blocks[0]), "just some bare text & more");
});

test("empty input yields no blocks", () => {
	assert.deepEqual(htmlToPortableText(""), []);
	assert.deepEqual(htmlToPortableText(null), []);
});

test("normalizeHref collapses stacked schemes, keeping the innermost scheme", () => {
	assert.equal(
		normalizeHref("https://https://roadtostudy.com//taksitle-alisveris-odeme-planlamasi/"),
		"https://roadtostudy.com/taksitle-alisveris-odeme-planlamasi/",
	);
	assert.equal(normalizeHref("http://https://roadtostudy.com/x"), "https://roadtostudy.com/x");
	assert.equal(normalizeHref("https://http://roadtostudy.com/x"), "http://roadtostudy.com/x");
	// triple stack still resolves to the innermost
	assert.equal(normalizeHref("https://https://https://roadtostudy.com/x"), "https://roadtostudy.com/x");
});

test("normalizeHref collapses a doubled slash after the internal host only", () => {
	assert.equal(normalizeHref("https://roadtostudy.com//guide/"), "https://roadtostudy.com/guide/");
	assert.equal(normalizeHref("https://www.roadtostudy.com///guide/"), "https://www.roadtostudy.com/guide/");
	// external hosts: `//` in the path could be meaningful — untouched
	assert.equal(normalizeHref("https://example.com//guide/"), "https://example.com//guide/");
});

test("normalizeHref never touches valid URLs", () => {
	for (const url of [
		"https://roadtostudy.com/turkiyede-universite/",
		"https://example.com/a?b=https://roadtostudy.com/c", // scheme in query, not stacked
		"/relative/path/",
		"#anchor",
		"mailto:hi@roadtostudy.com",
		"",
	]) {
		assert.equal(normalizeHref(url), url);
	}
});

test("normalizeHtmlHrefs rewrites only malformed href attributes, byte-for-byte otherwise", () => {
	const html =
		'<p>Bu konuda <a href="https://https://roadtostudy.com//pazarlar/">yazı</a> ve ' +
		"<a href='https://https://roadtostudy.com//sim/'>diğeri</a> ile " +
		'<a href="https://example.com/ok">dış</a>, <img src="https://https://roadtostudy.com//x.jpg"></p>';
	assert.equal(
		normalizeHtmlHrefs(html),
		'<p>Bu konuda <a href="https://roadtostudy.com/pazarlar/">yazı</a> ve ' +
			"<a href='https://roadtostudy.com/sim/'>diğeri</a> ile " +
			// src is intentionally left alone (only hrefs are audited/fixed)
			'<a href="https://example.com/ok">dış</a>, <img src="https://https://roadtostudy.com//x.jpg"></p>',
	);
	const clean = '<p><a href="https://roadtostudy.com/a/">a</a></p>';
	assert.equal(normalizeHtmlHrefs(clean), clean);
});

test("portable-text link markDefs get normalized hrefs", () => {
	const [b] = htmlToPortableText('<p>see <a href="https://https://roadtostudy.com//guide/">guide</a></p>');
	assert.equal(b.markDefs[0].href, "https://roadtostudy.com/guide/");
});

test("reading-time shape: blocks are _type block with span children carrying text", () => {
	const blocks = htmlToPortableText("<p>one two three</p><ul><li>four five</li></ul>");
	for (const b of blocks) {
		assert.equal(b._type, "block");
		assert.ok(Array.isArray(b.children));
		for (const c of b.children) {
			assert.equal(c._type, "span");
			assert.equal(typeof c.text, "string");
		}
	}
});

test("isProseHref: only absolute hrefs with whitespace that fail URL parsing", () => {
	assert.equal(isProseHref("http://Türkiye'nin UNESCO Dünya Mirası Alanları Rehberi"), true);
	assert.equal(isProseHref("https://www.Funds provided by tubitak.gov.tr/"), true);
	// valid URLs, relative paths, and non-absolute prose never match
	assert.equal(isProseHref("https://roadtostudy.com/a/"), false);
	assert.equal(isProseHref("/foo bar/"), false);
	assert.equal(isProseHref("mailto:x@y.z"), false);
	assert.equal(isProseHref("just some text"), false);
});

test("prose hrefs are unlinked: html loses the href attribute, portable text loses the mark", () => {
	const html = '<p><a href="http://Türkiye bu rehberde anlatılan yerler">metin</a> ve <a href="https://roadtostudy.com/a/">gerçek link</a></p>';
	const fixedHtml = normalizeHtmlHrefs(html);
	assert.ok(!fixedHtml.includes("http://Türkiye"));
	assert.ok(fixedHtml.includes('<a href="https://roadtostudy.com/a/">gerçek link</a>'));
	const [b] = htmlToPortableText(html);
	assert.equal(b.markDefs.length, 1);
	assert.equal(b.markDefs[0].href, "https://roadtostudy.com/a/");
	const prose = b.children.find((c) => c.text.includes("metin"));
	assert.deepEqual(prose.marks, []);
});
