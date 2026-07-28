import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import { cloudflareCache, d1, r2 } from "@emdash-cms/cloudflare";
import { defineConfig, fontProviders } from "astro/config";
import emdash from "emdash/astro";

export default defineConfig({
	output: "server",
	// Route caching. Content pages already call Astro.cache.set(cacheHint), but with no
	// provider configured those calls stored nothing, so every request re-rendered and hit
	// D1 — the dominant cost and latency driver at this corpus size. This wires the
	// provider that makes them store to Cloudflare's edge Cache API; on a hit the Worker
	// serves the rendered response with near-zero CPU and no D1 read.
	//
	// The provider caches GET only and bypasses the cache whenever an `astro-session=`
	// cookie is present, so a logged-in editor always sees live content.
	//
	// TTLs are deliberately short so this is correct with NO extra setup. Tag-based purge on
	// content edits needs CF_ZONE_ID + CF_CACHE_PURGE_TOKEN as Worker secrets; without them
	// the purge call errors and a page can only go stale until its TTL expires. At 60s that
	// is a non-event for a mostly-static migrated corpus, and it still removes essentially
	// every repeat render — the win here is volume, not TTL length. If those secrets get
	// set, maxAge can go up (600/3600 was the original proposal) since purge then makes
	// staleness bounded by the edit, not by the clock.
	experimental: {
		cache: { provider: cloudflareCache() },
		routeRules: {
			"/": { maxAge: 60, swr: 600 },
			"/posts": { maxAge: 60, swr: 600 },
			"/[...path]": { maxAge: 60, swr: 600 },
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
