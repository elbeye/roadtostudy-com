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

	let baseOrigin;
	try {
		baseOrigin = new URL(baseUrl).origin;
	} catch {
		baseOrigin = null;
	}

	const basePrefix = (() => {
		try {
			return new URL(baseUrl).protocol;
		} catch {
			return null;
		}
	})();

	// Matches any of the four reference forms, leading with an optional host part:
	//   scheme://host/..., //host/..., bare-host/... (host contains a dot), or /wp-content/...
	const pattern = /(?:https?:\/\/[^\s"'()<>]+|\/\/[^\s"'()<>]+|[^\s"'()<>/]*\.[^\s"'()<>/]+\/[^\s"'()<>]*wp-content\/uploads\/[^\s"'()<>]+|\/wp-content\/uploads\/[^\s"'()<>]+)/gi;
	const TRAILING_PUNCTUATION = /[.,;:!?)"'<>]+$/;
	for (const list of [source.content?.posts || [], source.content?.pages || []]) {
		for (const item of list) {
			// Featured image may come from _embedded wp:featuredmedia rather than the
			// top-level media array (the same source buildFeaturedImage falls back to),
			// so include it here or those featured images never get uploaded → 404.
			add(item._embedded?.["wp:featuredmedia"]?.[0]?.source_url);

			const html = item.content?.raw || item.content?.rendered || "";
			for (const match of html.matchAll(pattern)) {
				const cleaned = match[0].replace(TRAILING_PUNCTUATION, "");
				if (/^https?:\/\//i.test(cleaned)) {
					// Absolute with scheme: include only if same origin as baseUrl.
					let origin;
					try {
						origin = new URL(cleaned).origin;
					} catch {
						continue;
					}
					if (!baseOrigin || origin !== baseOrigin) continue;
					add(cleaned);
				} else if (/^\/\//.test(cleaned)) {
					// Protocol-relative: resolve against baseUrl's protocol, then check origin.
					if (!basePrefix) continue;
					let origin;
					try {
						origin = new URL(`${basePrefix}${cleaned}`).origin;
					} catch {
						continue;
					}
					if (!baseOrigin || origin !== baseOrigin) continue;
					add(`${basePrefix}${cleaned}`);
				} else if (/^\/wp-content\//i.test(cleaned)) {
					// True root-relative (single leading slash, no host): always belongs to source site.
					add(cleaned);
				}
				// Anything else is a bare-host schemeless reference (e.g. "evil.com/wp-content/...");
				// the leading dotted token is a foreign host, so it is excluded.
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
	// provider:"external" is REQUIRED — EmDash's normalizeMediaValue deletes `src`
	// for provider "local"; our images live at the preserved /wp-content/uploads/
	// path (not the EmDash media library), so they must be external to keep `src`.
	const image = { provider: "external", src, alt: media.alt_text || title };
	const mediaTitle = media.title?.rendered || media.title?.raw;
	if (mediaTitle) image.title = String(mediaTitle).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
	return image;
}
