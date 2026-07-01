import { test } from "node:test";
import assert from "node:assert/strict";
import {
	r2KeyFromUrl,
	mediaPathFromUrl,
	contentTypeForKey,
	collectMediaUrls,
	buildFeaturedImage,
} from "./wp-media-lib.mjs";

const OPTS = { baseUrl: "https://roadtostudy.com" };

test("r2KeyFromUrl strips origin and leading slash", () => {
	assert.equal(
		r2KeyFromUrl("https://roadtostudy.com/wp-content/uploads/2020/05/img.jpg", OPTS),
		"wp-content/uploads/2020/05/img.jpg",
	);
});

test("r2KeyFromUrl decodes percent-encoding", () => {
	assert.equal(
		r2KeyFromUrl("https://roadtostudy.com/wp-content/uploads/2020/05/a%20b.jpg", OPTS),
		"wp-content/uploads/2020/05/a b.jpg",
	);
});

test("r2KeyFromUrl accepts root-relative paths", () => {
	assert.equal(
		r2KeyFromUrl("/wp-content/uploads/x.png", OPTS),
		"wp-content/uploads/x.png",
	);
});

test("r2KeyFromUrl returns null for non-uploads urls", () => {
	assert.equal(r2KeyFromUrl("https://roadtostudy.com/wp-content/themes/a.css", OPTS), null);
	assert.equal(r2KeyFromUrl("not a url", OPTS), null);
});

test("mediaPathFromUrl returns root-relative path", () => {
	assert.equal(
		mediaPathFromUrl("https://roadtostudy.com/wp-content/uploads/x.png", OPTS),
		"/wp-content/uploads/x.png",
	);
});

test("contentTypeForKey maps by extension", () => {
	assert.equal(contentTypeForKey("a/b/img.JPG"), "image/jpeg");
	assert.equal(contentTypeForKey("a.webp"), "image/webp");
	assert.equal(contentTypeForKey("a.svg"), "image/svg+xml");
	assert.equal(contentTypeForKey("a.unknownext"), "application/octet-stream");
});

test("collectMediaUrls unions library, featured, and body refs", () => {
	const source = {
		content: {
			media: [{ id: 1, source_url: "https://roadtostudy.com/wp-content/uploads/lib.jpg" }],
			posts: [
				{
					content: { raw: '<img src="https://roadtostudy.com/wp-content/uploads/body.png">' },
				},
			],
			pages: [
				{ content: { raw: '<a href="/wp-content/uploads/doc.pdf">x</a>' } },
			],
		},
	};
	const urls = collectMediaUrls(source, OPTS);
	const keys = urls.map((u) => r2KeyFromUrl(u, OPTS)).sort();
	assert.deepEqual(keys, [
		"wp-content/uploads/body.png",
		"wp-content/uploads/doc.pdf",
		"wp-content/uploads/lib.jpg",
	]);
});

test("collectMediaUrls strips a trailing period from body-scanned urls", () => {
	const source = {
		content: {
			posts: [
				{
					content: {
						raw: "See https://roadtostudy.com/wp-content/uploads/a.jpg.",
					},
				},
			],
		},
	};
	const urls = collectMediaUrls(source, OPTS);
	assert.deepEqual(urls, ["https://roadtostudy.com/wp-content/uploads/a.jpg"]);
});

test("collectMediaUrls strips trailing prose punctuation like ),; from body-scanned urls", () => {
	const source = {
		content: {
			posts: [
				{
					content: {
						raw: "(see https://roadtostudy.com/wp-content/uploads/b.png), also https://roadtostudy.com/wp-content/uploads/c.gif; and https://roadtostudy.com/wp-content/uploads/d.pdf:",
					},
				},
			],
		},
	};
	const urls = collectMediaUrls(source, OPTS);
	const keys = urls.map((u) => r2KeyFromUrl(u, OPTS)).sort();
	assert.deepEqual(keys, [
		"wp-content/uploads/b.png",
		"wp-content/uploads/c.gif",
		"wp-content/uploads/d.pdf",
	]);
});

test("collectMediaUrls excludes foreign-origin absolute urls found in body scan", () => {
	const source = {
		content: {
			posts: [
				{
					content: {
						raw: '<img src="https://evil.com/wp-content/uploads/x.jpg">',
					},
				},
			],
		},
	};
	const urls = collectMediaUrls(source, OPTS);
	assert.deepEqual(urls, []);
});

test("collectMediaUrls still includes same-origin absolute urls in body scan", () => {
	const source = {
		content: {
			posts: [
				{
					content: {
						raw: '<img src="https://roadtostudy.com/wp-content/uploads/same-origin.jpg">',
					},
				},
			],
		},
	};
	const urls = collectMediaUrls(source, OPTS);
	assert.deepEqual(urls, ["https://roadtostudy.com/wp-content/uploads/same-origin.jpg"]);
});

test("collectMediaUrls still includes root-relative urls in body scan", () => {
	const source = {
		content: {
			pages: [
				{ content: { raw: '<a href="/wp-content/uploads/doc2.pdf">x</a>' } },
			],
		},
	};
	const urls = collectMediaUrls(source, OPTS);
	assert.deepEqual(urls, ["https://roadtostudy.com/wp-content/uploads/doc2.pdf"]);
});

test("collectMediaUrls excludes protocol-relative foreign-origin urls in body scan", () => {
	const source = {
		content: {
			posts: [
				{
					content: {
						raw: '<img src="//evil.com/wp-content/uploads/x.jpg">',
					},
				},
			],
		},
	};
	const urls = collectMediaUrls(source, OPTS);
	assert.deepEqual(urls, []);
});

test("collectMediaUrls includes protocol-relative same-origin urls in body scan", () => {
	const source = {
		content: {
			posts: [
				{
					content: {
						raw: '<img src="//roadtostudy.com/wp-content/uploads/pr.jpg">',
					},
				},
			],
		},
	};
	const urls = collectMediaUrls(source, OPTS);
	assert.deepEqual(urls, ["https://roadtostudy.com/wp-content/uploads/pr.jpg"]);
});

test("collectMediaUrls excludes bare-host schemeless urls in body scan", () => {
	const source = {
		content: {
			posts: [
				{
					content: {
						raw: "See evil.com/wp-content/uploads/x.jpg for details",
					},
				},
			],
		},
	};
	const urls = collectMediaUrls(source, OPTS);
	assert.deepEqual(urls, []);
});

test("buildFeaturedImage returns plain object with alt fallback", () => {
	const img = buildFeaturedImage(
		{ source_url: "https://roadtostudy.com/wp-content/uploads/f.jpg", alt_text: "" },
		"My Title",
		OPTS,
	);
	assert.deepEqual(img, { src: "/wp-content/uploads/f.jpg", alt: "My Title" });
});

test("buildFeaturedImage returns null without a source_url", () => {
	assert.equal(buildFeaturedImage({}, "t", OPTS), null);
});
