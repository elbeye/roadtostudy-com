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
