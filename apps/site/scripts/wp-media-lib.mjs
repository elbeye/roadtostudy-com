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
