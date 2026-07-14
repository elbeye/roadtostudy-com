import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import { cloudflareCache, d1, r2 } from "@emdash-cms/cloudflare";
import { defineConfig, fontProviders } from "astro/config";
import emdash from "emdash/astro";

export default defineConfig({
	output: "server",
	// Route caching (spec: cost + speed). Renders every public content page once,
	// then serves it from Cloudflare's edge Cache API — near-zero Worker CPU and no
	// D1 read on a hit. The pages already call Astro.cache.set(cacheHint); this wires
	// the provider that makes those calls store to the edge. The provider only caches
	// GET requests and BYPASSES the cache whenever an `astro-session=` cookie is
	// present, so logged-in admins always see live (uncached) content.
	//
	// maxAge/swr cap staleness even before purge creds are set: a page is fresh for
	// maxAge, then served stale (revalidating in the background) for up to swr more.
	// IMPORTANT: set CF_ZONE_ID and CF_CACHE_PURGE_TOKEN as Worker secrets so a content
	// edit purges the affected pages immediately (tag-based purge); without them the
	// cache only expires on the TTL below and the admin's invalidate call will error.
	experimental: {
		cache: { provider: cloudflareCache() },
		routeRules: {
			"/": { maxAge: 600, swr: 3600 },
			"/posts": { maxAge: 600, swr: 3600 },
			"/[...path]": { maxAge: 600, swr: 3600 },
		},
	},
	// Enables EmDash localization (admin language UI + locale-aware content). EmDash
	// reads this Astro i18n block. TR is the unprefixed default to match the preserved
	// WordPress URL scheme (/{slug}/ for TR, /{locale}/{slug}/ for others); public
	// routing stays handled by src/pages/[...path].astro.
	i18n: {
		defaultLocale: "tr",
		locales: ["tr", "en", "fr", "id"],
		routing: {
			prefixDefaultLocale: false,
			redirectToDefaultLocale: false,
		},
	},
	adapter: cloudflare({
		imageService: "passthrough",
		prerenderEnvironment: "node",
	}),
	vite: {
		build: {
			minify: false,
			sourcemap: false,
		},
	},
	image: {
		layout: "constrained",
		responsiveStyles: true,
	},
	integrations: [
		react(),
		emdash({
			database: d1({ binding: "DB", session: "auto" }),
			storage: r2({ binding: "MEDIA" }),
		}),
	],
	fonts: [
		{
			provider: fontProviders.google(),
			name: "Inter",
			cssVariable: "--font-sans",
			weights: [400, 500, 600, 700],
			fallbacks: ["sans-serif"],
		},
		{
			provider: fontProviders.google(),
			name: "JetBrains Mono",
			cssVariable: "--font-mono",
			weights: [400, 500],
			fallbacks: ["monospace"],
		},
	],
	devToolbar: { enabled: false },
});
