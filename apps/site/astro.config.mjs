import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import { d1, r2 } from "@emdash-cms/cloudflare";
import { defineConfig, fontProviders } from "astro/config";
import emdash from "emdash/astro";

export default defineConfig({
	output: "server",
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
