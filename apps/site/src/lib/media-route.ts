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
