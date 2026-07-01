# Media URL Preservation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve migrated WordPress media from its original `/wp-content/uploads/...` path on the same domain (via a Cloudflare Workers route reading R2), and migrate the media bytes + metadata without hitting the Worker invocation limit — so no image URL ever changes and SEO/Google-Images value is preserved.

**Architecture:** Two decoupled tracks. (1) **Serve:** an Astro API endpoint `src/pages/wp-content/uploads/[...path].ts` maps the request path directly to an R2 object key (`wp-content/uploads/...`, no DB lookup), fronted by the Cloudflare Cache API so repeat hits skip R2. (2) **Migrate:** a local Node script uploads bytes to R2 via the S3-compatible API (bypassing the Worker), while the seed transform writes `featured_image` as a plain `{ src, alt, title }` object (no `$media` download). Body HTML is left untouched because paths are preserved.

**Tech Stack:** Astro 6 + `@astrojs/cloudflare` (Workers/D1/R2), EmDash 0.24.1, Node 22 (`node:test` + `--experimental-strip-types` for tests), `aws4fetch` (R2 S3 client, new devDependency).

## Global Constraints

- Version floors are pinned and must not be bumped: `emdash@0.24.1`, `@emdash-cms/cloudflare@0.24.1`, `astro@6.4.8`, `@astrojs/cloudflare@13.7.0`, `vite@7.3.6` (override). Do not upgrade these.
- Image URLs must NEVER change: canonical media path stays `/wp-content/uploads/<year>/<month>/<file>` on the same domain. This is a cutover blocker (spec §6.8).
- R2 object key = the original path with no leading slash, e.g. `wp-content/uploads/2020/05/img.jpg`. Serve path decoding and upload key derivation must agree (both operate on percent-decoded paths).
- Serve route must do a single R2 `get()` and NO D1 query (keeps D1 in free tier; spec §7.5).
- Serve route MUST use the Cache API (`caches.default`); without it R2 read ops scale with traffic (spec §7.5 cost requirement).
- Media bytes must reach R2 WITHOUT the EmDash `$media`/Worker upload path (that hit the Worker invocation limit; spec §3.3).
- All content pages are server-rendered (`output: "server"`); no `getStaticPaths()` for CMS content.
- EmDash image field values are objects `{ id?, src?, alt?, width?, height? }`, not strings.
- R2 credentials (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`) are read from `.env`; never commit secret values.

## Prerequisites (user-provided, one-time)

Before **Task 4** can run against real R2, the user must create an **R2 API token** (S3 credentials) in the Cloudflare dashboard (R2 → Manage API Tokens → Object Read & Write for the `roadtostudy-emdash-media-poc` bucket) and add to `apps/site/.env`:

```
R2_ACCOUNT_ID=<cloudflare account id>
R2_ACCESS_KEY_ID=<r2 access key id>
R2_SECRET_ACCESS_KEY=<r2 secret access key>
R2_BUCKET=roadtostudy-emdash-media-poc
```

Tasks 1–3 and 5 are fully offline-testable against `data/wp-sample.json` and need no credentials.

---

## File Structure

- **Create** `apps/site/scripts/wp-media-lib.mjs` — shared, pure, dependency-free helpers used by both the upload script and the seed transform: URL→R2-key, URL→media-path, content-type map, media-URL collection, featured-image builder.
- **Create** `apps/site/scripts/wp-media-lib.test.mjs` — `node:test` unit tests for the above.
- **Create** `apps/site/src/lib/media-route.ts` — serve-route core: `contentTypeForPath`, `serveMediaObject` (injectable bucket/cache for testability).
- **Create** `apps/site/src/lib/media-route.test.ts` — type-stripped `node:test` unit tests with a fake R2 bucket + fake cache.
- **Create** `apps/site/src/pages/wp-content/uploads/[...path].ts` — thin Astro endpoint wiring `locals.runtime.env.MEDIA` + `caches.default` into `serveMediaObject`.
- **Create** `apps/site/scripts/wp-media-to-r2.mjs` — bytes upload script (S3 API, resumable, concurrent, `--dry-run`).
- **Modify** `apps/site/scripts/wp-sample-to-emdash-seed.mjs` — replace the `$media` branch with `buildFeaturedImage` (plain object).
- **Modify** `apps/site/package.json` — add `media:upload` + `test` scripts and `aws4fetch` devDependency.
- **Modify** `docs/superpowers/specs/2026-06-30-wp-to-payload-cloudflare-migration-design.md` — update §3.3 status note after live verify.

---

## Task 1: Shared media helpers (`scripts/wp-media-lib.mjs`)

**Files:**
- Create: `apps/site/scripts/wp-media-lib.mjs`
- Test: `apps/site/scripts/wp-media-lib.test.mjs`

**Interfaces:**
- Produces:
  - `r2KeyFromUrl(url: string, opts?: { baseUrl?: string }): string | null` — returns `wp-content/uploads/...` (decoded, no leading slash) or `null` if the URL is not an uploads URL.
  - `mediaPathFromUrl(url: string, opts?): string | null` — returns `/wp-content/uploads/...` or `null`.
  - `contentTypeForKey(key: string): string` — MIME from file extension.
  - `collectMediaUrls(source: object, opts?): string[]` — deduped absolute WP media URLs from the media library, featured media, and body scans.
  - `buildFeaturedImage(media: object, title: string, opts?): { src: string, alt: string, title?: string } | null`.

- [ ] **Step 1: Write the failing tests**

Create `apps/site/scripts/wp-media-lib.test.mjs`:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/site && node --test scripts/wp-media-lib.test.mjs`
Expected: FAIL — `Cannot find module './wp-media-lib.mjs'`.

- [ ] **Step 3: Write the implementation**

Create `apps/site/scripts/wp-media-lib.mjs`:

```js
const DEFAULT_BASE_URL = "https://roadtostudy.com";
const UPLOADS_PREFIX = "wp-content/uploads/";

const MIME_BY_EXT = {
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	png: "image/png",
	webp: "image/webp",
	gif: "image/gif",
	svg: "image/svg+xml",
	avif: "image/avif",
	ico: "image/x-icon",
	bmp: "image/bmp",
	pdf: "application/pdf",
	mp4: "video/mp4",
	webm: "video/webm",
};

export function r2KeyFromUrl(url, { baseUrl = DEFAULT_BASE_URL } = {}) {
	let pathname;
	try {
		pathname = new URL(url, baseUrl).pathname;
	} catch {
		return null;
	}
	let decoded;
	try {
		decoded = decodeURIComponent(pathname);
	} catch {
		decoded = pathname;
	}
	const key = decoded.replace(/^\/+/, "");
	return key.startsWith(UPLOADS_PREFIX) ? key : null;
}

export function mediaPathFromUrl(url, opts) {
	const key = r2KeyFromUrl(url, opts);
	return key ? `/${key}` : null;
}

export function contentTypeForKey(key) {
	const ext = key.split(".").pop()?.toLowerCase() || "";
	return MIME_BY_EXT[ext] || "application/octet-stream";
}

export function collectMediaUrls(source, { baseUrl = DEFAULT_BASE_URL } = {}) {
	const byKey = new Map();
	const add = (url) => {
		if (!url) return;
		const key = r2KeyFromUrl(url, { baseUrl });
		if (!key || byKey.has(key)) return;
		byKey.set(key, new URL(url, baseUrl).href);
	};

	for (const item of source.content?.media || []) add(item.source_url);

	const pattern = /(?:https?:\/\/[^\s"'()<>]+)?\/wp-content\/uploads\/[^\s"'()<>]+/gi;
	for (const list of [source.content?.posts || [], source.content?.pages || []]) {
		for (const item of list) {
			const html = item.content?.raw || item.content?.rendered || "";
			for (const match of html.matchAll(pattern)) {
				add(match[0].replace(/["'<>]+$/, ""));
			}
		}
	}

	return [...byKey.values()];
}

export function buildFeaturedImage(media, title, opts) {
	const sourceUrl = media?.source_url;
	if (!sourceUrl) return null;
	const src = mediaPathFromUrl(sourceUrl, opts);
	if (!src) return null;
	const image = { src, alt: media.alt_text || title };
	const mediaTitle = media.title?.rendered || media.title?.raw;
	if (mediaTitle) image.title = String(mediaTitle).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
	return image;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/site && node --test scripts/wp-media-lib.test.mjs`
Expected: PASS — all 9 tests pass.

- [ ] **Step 5: Commit**

```bash
cd apps/site
git add scripts/wp-media-lib.mjs scripts/wp-media-lib.test.mjs
git commit -m "feat: shared media URL/key helpers for migration"
```

---

## Task 2: Serve-route core (`src/lib/media-route.ts`)

**Files:**
- Create: `apps/site/src/lib/media-route.ts`
- Test: `apps/site/src/lib/media-route.test.ts`

**Interfaces:**
- Produces:
  - `contentTypeForPath(path: string): string`
  - `serveMediaObject(params: { bucket: R2Like; cache?: CacheLike; request: Request; key: string; waitUntil?: (p: Promise<unknown>) => void }): Promise<Response>`
  - Types `R2Like`, `R2ObjectBodyLike`, `CacheLike` (structural, so the real Cloudflare `R2Bucket`/`Cache` satisfy them and tests can pass fakes).

- [ ] **Step 1: Write the failing tests**

Create `apps/site/src/lib/media-route.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/site && node --experimental-strip-types --test src/lib/media-route.test.ts`
Expected: FAIL — cannot find `./media-route.ts`.

- [ ] **Step 3: Write the implementation**

Create `apps/site/src/lib/media-route.ts`:

```ts
export interface R2ObjectBodyLike {
	body: ReadableStream | null;
	httpEtag: string;
	size: number;
	httpMetadata?: { contentType?: string };
	writeHttpMetadata?(headers: Headers): void;
}

export interface R2Like {
	get(key: string): Promise<R2ObjectBodyLike | null>;
}

export interface CacheLike {
	match(request: Request): Promise<Response | undefined>;
	put(request: Request, response: Response): Promise<void>;
}

const MIME_BY_EXT: Record<string, string> = {
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	png: "image/png",
	webp: "image/webp",
	gif: "image/gif",
	svg: "image/svg+xml",
	avif: "image/avif",
	ico: "image/x-icon",
	bmp: "image/bmp",
	pdf: "application/pdf",
	mp4: "video/mp4",
	webm: "video/webm",
};

export function contentTypeForPath(path: string): string {
	const ext = path.split(".").pop()?.toLowerCase() || "";
	return MIME_BY_EXT[ext] || "application/octet-stream";
}

export async function serveMediaObject(params: {
	bucket: R2Like;
	cache?: CacheLike;
	request: Request;
	key: string;
	waitUntil?: (p: Promise<unknown>) => void;
}): Promise<Response> {
	const { bucket, cache, request, key, waitUntil } = params;

	if (request.method !== "GET" && request.method !== "HEAD") {
		return new Response("Method Not Allowed", {
			status: 405,
			headers: { Allow: "GET, HEAD" },
		});
	}

	if (cache) {
		const hit = await cache.match(request);
		if (hit) return hit;
	}

	const object = await bucket.get(key);
	if (!object) return new Response("Not Found", { status: 404 });

	const headers = new Headers();
	if (object.writeHttpMetadata) object.writeHttpMetadata(headers);
	if (!headers.has("Content-Type")) {
		headers.set("Content-Type", object.httpMetadata?.contentType || contentTypeForPath(key));
	}
	headers.set("Cache-Control", "public, max-age=31536000, immutable");
	headers.set("ETag", object.httpEtag);

	const ifNoneMatch = request.headers.get("If-None-Match");
	if (ifNoneMatch && ifNoneMatch === object.httpEtag) {
		return new Response(null, { status: 304, headers });
	}

	const body = request.method === "HEAD" ? null : object.body;
	const response = new Response(body, { status: 200, headers });

	if (cache && request.method === "GET") {
		const put = cache.put(request, response.clone());
		if (waitUntil) waitUntil(put);
		else await put;
	}

	return response;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/site && node --experimental-strip-types --test src/lib/media-route.test.ts`
Expected: PASS — all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
cd apps/site
git add src/lib/media-route.ts src/lib/media-route.test.ts
git commit -m "feat: R2 media serve-route core with cache + etag handling"
```

---

## Task 3: Astro media endpoint (`src/pages/wp-content/uploads/[...path].ts`)

**Files:**
- Create: `apps/site/src/pages/wp-content/uploads/[...path].ts`

**Interfaces:**
- Consumes: `serveMediaObject` from `../../../lib/media-route` (Task 2).
- Produces: `GET` and `HEAD` Astro `APIRoute` handlers at `/wp-content/uploads/*`.

- [ ] **Step 1: Write the implementation**

Create `apps/site/src/pages/wp-content/uploads/[...path].ts`:

> **Astro 6 binding access:** Astro v6 + `@astrojs/cloudflare` removed `Astro.locals.runtime.env` (it now throws). Bindings and `waitUntil` come from the `cloudflare:workers` virtual module — this is the established convention in this stack (EmDash's own `@emdash-cms/cloudflare` imports `{ env, waitUntil } from "cloudflare:workers"`). `env.MEDIA` is typed `R2Bucket` via the generated `worker-configuration.d.ts`.

```ts
import type { APIRoute } from "astro";
import { env, waitUntil } from "cloudflare:workers";
import { serveMediaObject, type R2Like, type CacheLike } from "../../../lib/media-route.ts";

export const prerender = false;

const handler: APIRoute = async ({ params, request }) => {
	const path = params.path;
	if (!path) return new Response("Not Found", { status: 404 });

	const bucket = env.MEDIA as R2Like | undefined;
	if (!bucket) return new Response("Storage unavailable", { status: 500 });

	const key = `wp-content/uploads/${path}`;
	const cache = (globalThis as { caches?: { default?: CacheLike } }).caches?.default;

	return serveMediaObject({ bucket, cache, request, key, waitUntil });
};

export const GET = handler;
export const HEAD = handler;
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/site && npm run typecheck`
Expected: PASS — no errors for `src/pages/wp-content/uploads/[...path].ts` or `src/lib/media-route.ts`.

- [ ] **Step 3: Local dev smoke test**

Start the dev server, seed a known object into the local (Miniflare) R2 bucket, and verify the route serves it. Run:

```bash
cd apps/site
npx emdash dev &
sleep 20
# Put a test object into the local R2 bucket used by wrangler/miniflare:
npx wrangler r2 object put roadtostudy-emdash-media-poc/wp-content/uploads/smoke/test.txt --file <(printf 'hello-media') --local
curl -si "http://localhost:4321/wp-content/uploads/smoke/test.txt"
kill %1
```

Expected: `HTTP/1.1 200`, header `Cache-Control: public, max-age=31536000, immutable`, an `ETag` header, and body `hello-media`. Then `curl -si "http://localhost:4321/wp-content/uploads/does-not-exist.jpg"` returns `404`.

> If `--local` bucket wiring differs in this EmDash/wrangler version, instead verify the route boots (returns 500 "Storage unavailable" only when `MEDIA` is unbound, otherwise 404 for a missing key) and defer the true 200 check to the live verify in Task 6. Record which path was taken.

- [ ] **Step 4: Commit**

```bash
cd apps/site
git add src/pages/wp-content/uploads/
git commit -m "feat: serve /wp-content/uploads/* from R2 via Workers route"
```

---

## Task 4: Media bytes upload script (`scripts/wp-media-to-r2.mjs`)

**Files:**
- Create: `apps/site/scripts/wp-media-to-r2.mjs`
- Modify: `apps/site/package.json` (add `aws4fetch` devDependency + `media:upload` and `test` scripts)

**Interfaces:**
- Consumes: `collectMediaUrls`, `r2KeyFromUrl`, `contentTypeForKey` from `./wp-media-lib.mjs` (Task 1); `AwsClient` from `aws4fetch`.
- Produces: CLI `node scripts/wp-media-to-r2.mjs [--dry-run]`. Reads `data/wp-sample.json`, uploads every media object to R2 under its original key, skips objects already present (resume), and prints a JSON summary `{ total, uploaded, skipped, failed, verifiedOk, verifyFailed }`.

- [ ] **Step 1: Add the dependency and scripts**

Run:

```bash
cd apps/site
npm pkg set devDependencies.aws4fetch="^1.0.20"
npm pkg set scripts.media:upload="node --env-file=.env scripts/wp-media-to-r2.mjs"
npm pkg set scripts.test="node --test scripts/*.test.mjs && node --experimental-strip-types --test src/lib/*.test.ts"
npm install
```

Expected: `aws4fetch` appears in `devDependencies`; `npm run test` runs Task 1 + Task 2 suites and passes.

- [ ] **Step 2: Write the implementation**

Create `apps/site/scripts/wp-media-to-r2.mjs`:

```js
import { readFile } from "node:fs/promises";
import { AwsClient } from "aws4fetch";
import { collectMediaUrls, r2KeyFromUrl, contentTypeForKey } from "./wp-media-lib.mjs";

const inputPath = process.env.WP_SAMPLE_INPUT || "data/wp-sample.json";
const baseUrl = process.env.WP_BASE_URL || "https://roadtostudy.com";
const bucket = process.env.R2_BUCKET || "roadtostudy-emdash-media-poc";
const concurrency = Math.max(1, Number(process.env.WP_MEDIA_CONCURRENCY || 8));
const dryRun = process.argv.includes("--dry-run");

const source = JSON.parse(await readFile(inputPath, "utf8"));
const urls = collectMediaUrls(source, { baseUrl });

if (dryRun) {
	console.log(
		JSON.stringify(
			{ dryRun: true, total: urls.length, sampleKeys: urls.slice(0, 5).map((u) => r2KeyFromUrl(u, { baseUrl })) },
			null,
			2,
		),
	);
	process.exit(0);
}

const accountId = requireEnv("R2_ACCOUNT_ID");
const accessKeyId = requireEnv("R2_ACCESS_KEY_ID");
const secretAccessKey = requireEnv("R2_SECRET_ACCESS_KEY");
const endpoint = `https://${accountId}.r2.cloudflarestorage.com/${bucket}`;
const aws = new AwsClient({ accessKeyId, secretAccessKey, service: "s3", region: "auto" });

function requireEnv(name) {
	const value = process.env[name];
	if (!value) throw new Error(`${name} must be set (see plan Prerequisites).`);
	return value;
}

function objectUrl(key) {
	return `${endpoint}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

async function exists(key) {
	const res = await aws.fetch(objectUrl(key), { method: "HEAD" });
	if (res.status === 200) return true;
	if (res.status === 404) return false;
	throw new Error(`HEAD ${key} -> ${res.status}`);
}

async function upload(url) {
	const key = r2KeyFromUrl(url, { baseUrl });
	if (!key) return { key: url, status: "skipped-nonuploads" };

	if (await exists(key)) return { key, status: "skipped-exists" };

	const download = await fetch(url);
	if (!download.ok) return { key, status: "failed", error: `download ${download.status}` };
	const bytes = new Uint8Array(await download.arrayBuffer());

	const put = await aws.fetch(objectUrl(key), {
		method: "PUT",
		body: bytes,
		headers: { "Content-Type": download.headers.get("content-type") || contentTypeForKey(key) },
	});
	if (!put.ok) return { key, status: "failed", error: `put ${put.status}` };
	return { key, status: "uploaded" };
}

async function runPool(items, worker) {
	const results = [];
	let index = 0;
	const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
		while (index < items.length) {
			const current = items[index++];
			results.push(await worker(current));
		}
	});
	await Promise.all(runners);
	return results;
}

const results = await runPool(urls, upload);

const summary = {
	total: urls.length,
	uploaded: results.filter((r) => r.status === "uploaded").length,
	skipped: results.filter((r) => r.status.startsWith("skipped")).length,
	failed: results.filter((r) => r.status === "failed"),
};

// Verify: every intended key now returns 200 from R2.
const verify = await runPool(urls, async (url) => {
	const key = r2KeyFromUrl(url, { baseUrl });
	if (!key) return { key: url, ok: true };
	try {
		return { key, ok: await exists(key) };
	} catch (error) {
		return { key, ok: false, error: String(error) };
	}
});
summary.verifiedOk = verify.filter((v) => v.ok).length;
summary.verifyFailed = verify.filter((v) => !v.ok);

console.log(JSON.stringify(summary, null, 2));
if (summary.failed.length > 0 || summary.verifyFailed.length > 0) process.exit(1);
```

- [ ] **Step 3: Offline dry-run smoke test**

Run: `cd apps/site && node scripts/wp-media-to-r2.mjs --dry-run`
Expected: JSON with `"dryRun": true` and a `total` > 0 (the sample export has media + body references), plus up to 5 `sampleKeys` all starting with `wp-content/uploads/`. No credentials required, exit code 0.

- [ ] **Step 4: Live upload (requires Prerequisites credentials)**

Run: `cd apps/site && npm run media:upload`
Expected: JSON summary with `failed: []` and `verifyFailed: []`, `uploaded + skipped === total`, `verifiedOk === total`, exit code 0. Re-running immediately should report all `skipped-exists` (idempotent/resume).

> If R2 credentials are not yet available, stop after Step 3 and hand back for the user to provide them; Steps 4 and Task 6 resume once set.

- [ ] **Step 5: Commit**

```bash
cd apps/site
git add scripts/wp-media-to-r2.mjs package.json package-lock.json
git commit -m "feat: resumable R2 media upload via S3 API (bypasses Worker limit)"
```

---

## Task 5: Seed transform writes plain featured_image (`scripts/wp-sample-to-emdash-seed.mjs`)

**Files:**
- Modify: `apps/site/scripts/wp-sample-to-emdash-seed.mjs`

**Interfaces:**
- Consumes: `buildFeaturedImage` from `./wp-media-lib.mjs` (Task 1).
- Produces: seed content where `featured_image` is `{ src: "/wp-content/uploads/...", alt, title? }` — no `$media`, no download.

- [ ] **Step 1: Add the import**

In `apps/site/scripts/wp-sample-to-emdash-seed.mjs`, add after the existing `node:fs/promises` import (line 1):

```js
import { buildFeaturedImage } from "./wp-media-lib.mjs";
```

- [ ] **Step 2: Replace the `$media` branch**

In `apps/site/scripts/wp-sample-to-emdash-seed.mjs`, replace the current block (lines 124-132):

```js
		if (includeMediaReferences && media?.source_url) {
			data.featured_image = {
				$media: {
					url: media.source_url,
					alt: media.alt_text || title,
					filename: filenameFromUrl(media.source_url),
				},
			};
		}
```

with:

```js
		if (includeMediaReferences) {
			const featured = buildFeaturedImage(media, title, { baseUrl: process.env.WP_BASE_URL });
			if (featured) data.featured_image = featured;
		}
```

- [ ] **Step 3: Remove the now-unused helper**

`filenameFromUrl` is no longer referenced. Delete its definition (lines 304-310):

```js
function filenameFromUrl(value) {
	try {
		return decodeURIComponent(new URL(value).pathname.split("/").pop() || "media");
	} catch {
		return "media";
	}
}
```

- [ ] **Step 4: Regenerate the seed and verify the shape**

Run:

```bash
cd apps/site
WP_SEED_MEDIA_REFERENCES=1 WP_BASE_URL=https://roadtostudy.com npm run wp:seed
node -e "const s=require('./data/wp-sample.emdash-seed.json'); const withImg=s.content.posts.filter(p=>p.data.featured_image); const bad=withImg.filter(p=>p.data.featured_image.\$media || !String(p.data.featured_image.src||'').startsWith('/wp-content/uploads/')); console.log(JSON.stringify({postsWithImage:withImg.length, malformed:bad.length, sample:withImg[0]?.data.featured_image}, null, 2)); process.exit(bad.length?1:0);"
```

Expected: `malformed: 0`; `postsWithImage` > 0; `sample` is a plain object like `{ "src": "/wp-content/uploads/...", "alt": "..." }` with NO `$media` key. Exit code 0.

> Note: default `wp:seed` (without the flag) omits `featured_image` entirely — that path is unchanged and still valid.

- [ ] **Step 5: Commit**

```bash
cd apps/site
git add scripts/wp-sample-to-emdash-seed.mjs seed/seed.json data/wp-sample.emdash-seed.json
git commit -m "feat: seed featured_image as plain path object (no \$media download)"
```

> If `npm run wp:seed` does not also refresh `seed/seed.json`, only stage the files it actually writes; do not hand-edit generated output.

---

## Task 6: Live end-to-end verify + spec status update

**Files:**
- Modify: `docs/superpowers/specs/2026-06-30-wp-to-payload-cloudflare-migration-design.md`

**Prerequisite:** Task 4 Step 4 (live upload) completed, and the seed from Task 5 imported to the PoC D1 (via the existing deploy/import flow used for the current PoC).

- [ ] **Step 1: Deploy and import**

Run the existing PoC deploy + seed-import flow (same commands used to produce the current live PoC) so the new route and the regenerated seed are live on `https://roadtostudy-emdash-poc.murat-elbeye.workers.dev`.

- [ ] **Step 2: Verify a featured image resolves (200, correct headers)**

Pick one `featured_image.src` from `data/wp-sample.emdash-seed.json` and request it against the live Worker. Run:

```bash
cd apps/site
IMGPATH=$(node -e "const s=require('./data/wp-sample.emdash-seed.json'); const p=s.content.posts.find(p=>p.data.featured_image); process.stdout.write(p.data.featured_image.src);")
curl -sI "https://roadtostudy-emdash-poc.murat-elbeye.workers.dev${IMGPATH}"
```

Expected: `HTTP/2 200`, `content-type: image/*`, `cache-control: public, max-age=31536000, immutable`, an `etag` header.

- [ ] **Step 3: Verify a body image reference resolves**

Run:

```bash
cd apps/site
BODYPATH=$(node -e "const {collectMediaUrls,mediaPathFromUrl}=require('./scripts/wp-media-lib.mjs'); const s=require('./data/wp-sample.json'); const u=collectMediaUrls(s,{baseUrl:'https://roadtostudy.com'})[0]; process.stdout.write(mediaPathFromUrl(u,{baseUrl:'https://roadtostudy.com'})||'');")
curl -sI "https://roadtostudy-emdash-poc.murat-elbeye.workers.dev${BODYPATH}"
```

Expected: `HTTP/2 200`. (If `wp-media-lib.mjs` uses ESM-only `export`, run this via a small `node --input-type=module` snippet instead; the goal is a 200 on one real body-referenced upload path.)

- [ ] **Step 4: Update the spec status note**

In `docs/superpowers/specs/2026-06-30-wp-to-payload-cloudflare-migration-design.md`, update the §3.3 media note to record that the media route + upload hattı is now implemented and live-verified, replacing the "kararlaştı / implementasyon writing-plans ile planlanır" wording with a dated "implemented + verified" line including the sample counts (total uploaded, verifiedOk) from Task 4's summary.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-06-30-wp-to-payload-cloudflare-migration-design.md
git commit -m "docs: medya route + upload hattı canlı doğrulandı (§3.3)"
```

---

## Self-Review Notes

- **Spec coverage:** §7.5 serve route → Tasks 2–3; §7.5 Cache API → Task 2 (cache tests) + Task 3 (wiring); §7.5 Track A bytes → Tasks 1 + 4; §7.5 Track B metadata → Tasks 1 + 5; §7.5 verification → Task 4 Step 4 + Task 6; §6.8 alt/title preserved → `buildFeaturedImage` (Task 1); §3.3 status closure → Task 6.
- **Deferred within this scope:** Range/video requests and attachment-page URLs are explicitly out of scope per spec §7.5 / §6.8 open items; the Rank Math SEO meta/schema diff is a separate plan.
- **Type consistency:** `r2KeyFromUrl`/`mediaPathFromUrl`/`contentTypeForKey`/`collectMediaUrls`/`buildFeaturedImage` signatures are identical across Tasks 1, 4, 5. `serveMediaObject`/`contentTypeForPath` signatures identical across Tasks 2, 3.
