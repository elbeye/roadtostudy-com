import { test } from "node:test";
import assert from "node:assert/strict";
import { contentTypeForPath, serveMediaObject } from "./media-route.ts";

function fakeObject(text: string, etag = '"etag1"') {
	return {
		httpEtag: etag,
		size: text.length,
		httpMetadata: { contentType: "image/png" },
		body: new Response(text).body,
		writeHttpMetadata(headers: Headers) {
			headers.set("Content-Type", "image/png");
		},
	};
}

function fakeBucket(store: Record<string, ReturnType<typeof fakeObject>>) {
	return { get: async (key: string) => store[key] ?? null };
}

function fakeCache() {
	const map = new Map<string, Response>();
	return {
		store: map,
		match: async (req: Request) => map.get(req.url),
		put: async (req: Request, res: Response) => {
			map.set(req.url, res);
		},
	};
}

test("contentTypeForPath maps by extension", () => {
	assert.equal(contentTypeForPath("wp-content/uploads/a.jpg"), "image/jpeg");
	assert.equal(contentTypeForPath("a.bin"), "application/octet-stream");
});

test("405 for non GET/HEAD", async () => {
	const res = await serveMediaObject({
		bucket: fakeBucket({}),
		request: new Request("https://x/wp-content/uploads/a.png", { method: "POST" }),
		key: "wp-content/uploads/a.png",
	});
	assert.equal(res.status, 405);
	assert.equal(res.headers.get("Allow"), "GET, HEAD");
});

test("404 when object missing", async () => {
	const res = await serveMediaObject({
		bucket: fakeBucket({}),
		request: new Request("https://x/wp-content/uploads/missing.png"),
		key: "wp-content/uploads/missing.png",
	});
	assert.equal(res.status, 404);
});

test("200 with immutable cache-control and etag", async () => {
	const key = "wp-content/uploads/a.png";
	const res = await serveMediaObject({
		bucket: fakeBucket({ [key]: fakeObject("PNGDATA") }),
		request: new Request(`https://x/${key}`),
		key,
	});
	assert.equal(res.status, 200);
	assert.equal(res.headers.get("Cache-Control"), "public, max-age=31536000, immutable");
	assert.equal(res.headers.get("ETag"), '"etag1"');
	assert.equal(res.headers.get("Content-Type"), "image/png");
	assert.equal(await res.text(), "PNGDATA");
});

test("304 when If-None-Match matches", async () => {
	const key = "wp-content/uploads/a.png";
	const res = await serveMediaObject({
		bucket: fakeBucket({ [key]: fakeObject("PNGDATA") }),
		request: new Request(`https://x/${key}`, { headers: { "If-None-Match": '"etag1"' } }),
		key,
	});
	assert.equal(res.status, 304);
});

test("HEAD returns no body", async () => {
	const key = "wp-content/uploads/a.png";
	const res = await serveMediaObject({
		bucket: fakeBucket({ [key]: fakeObject("PNGDATA") }),
		request: new Request(`https://x/${key}`, { method: "HEAD" }),
		key,
	});
	assert.equal(res.status, 200);
	assert.equal(await res.text(), "");
});

test("cache miss populates cache, hit is served from cache", async () => {
	const key = "wp-content/uploads/a.png";
	const cache = fakeCache();
	const bucket = fakeBucket({ [key]: fakeObject("PNGDATA") });
	const req = new Request(`https://x/${key}`);

	const first = await serveMediaObject({ bucket, cache, request: req, key });
	assert.equal(first.status, 200);
	assert.equal(cache.store.size, 1);

	const emptyBucket = fakeBucket({});
	const second = await serveMediaObject({ bucket: emptyBucket, cache, request: req, key });
	assert.equal(second.status, 200);
	assert.equal(await second.text(), "PNGDATA");
});
