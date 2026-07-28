This is an EmDash site -- a CMS built on Astro with a full admin UI.

> **This is no longer the stock template.** It is roadtostudy.com: a WordPress
> (Polylang + Rank Math) site migrated onto EmDash/Astro/Cloudflare, **live in
> production since 2026-07-12** with DNS pointed at the Worker. Content lives in
> prod D1 (~3.8k posts, 235 pages, 4 locales) and media in R2 — not in `seed/`.
> Sections below marked _(template default)_ describe the starter kit and no longer
> match this site. Read `## Migration facts` and `## Rules` before changing routing,
> URLs, taxonomies, or SEO output. Full context:
> `docs/superpowers/plans/2026-07-11-cutover-runbook.md`.

## Migration facts

- **Locales:** `tr` (default, **unprefixed**), `en`, `fr`, `id`. URL scheme is the
  preserved WordPress one: `/{slug}/` for TR, `/{locale}/{slug}/` for the rest, with
  trailing slashes. Never introduce `/tr/` URLs.
- **Routing is one catch-all**, `src/pages/[...path].astro`: posts, pages, category
  and tag archives, `/page/N/` archive pagination, and the localized language homes.
  The unprefixed root is `src/pages/index.astro`.
- **SEO parity is a hard requirement.** Migrated pages emit the source Rank Math head
  verbatim from `source_seo` (title/description/canonical/robots/OG/JSON-LD). Don't
  "improve" that output; a diff is a regression. `scripts/wp-seo-diff.mjs` checks it.
- **Content is in prod D1.** `seed/seed.json` (the ~186MB full seed) is intentionally
  **not tracked**; only the schema-only `seed/runtime.json` is, and that is what the
  build consumes. `npm run build` skips regeneration when the full seed is absent.
- **Media** is served from R2 through `src/pages/wp-content/uploads/[...path].ts`, so
  the original `/wp-content/uploads/...` URLs keep resolving.
- **Cutover gate:** `WP_TARGET_BASE=<origin> node scripts/wp-crawl-verify.mjs` must
  exit 0 before shipping anything that touches URLs, routing, or archives. It checks
  status *and* that archives actually render posts.

## Commands

```bash
npx emdash dev        # Start dev server (runs migrations, seeds, generates types)
npx emdash types      # Regenerate TypeScript types from schema
```

The admin UI is at `http://localhost:4321/_emdash/admin`.

## Key Files

| File                     | Purpose                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------- |
| `astro.config.mjs`       | Astro config with `emdash()` integration, database, storage, **and edge route cache** |
| `src/live.config.ts`     | EmDash loader registration (boilerplate -- don't modify)                           |
| `seed/runtime.json`      | **Schema-only seed the build actually applies** (`package.json` → `emdash.seed`); tracked |
| `seed/seed.json`         | Full migrated content (~186MB), **untracked/regenerable** via `npm run wp:seed:full`   |
| `src/middleware.ts`      | Applies the redirect layer — runs before routing, exempts `/404` + `/_emdash`        |
| `src/lib/redirects-data.mjs` | **The redirect rules** (877 exact + structural patterns) + the shared matcher. Edit rules HERE |
| `src/lib/redirects.ts`   | Typed façade over that data — no rules of its own                                   |
| `src/utils/hreflang.ts`  | hreflang clusters for content and taxonomy archives                                 |
| `scripts/wp-crawl-verify.mjs` | Cutover gate: URL status **and** archive content parity                        |
| `emdash-env.d.ts`        | Generated types for collections (auto-regenerated on dev server start)             |
| `src/layouts/Base.astro` | Base layout with EmDash wiring (menus, search, page contributions)                 |
| `src/pages/`             | Astro pages -- all server-rendered                                                 |

## Skills

Agent skills are in `.agents/skills/`. Load them when working on specific tasks:

- **building-emdash-site** -- Querying content, rendering Portable Text, schema design, seed files, site features (menus, widgets, search, SEO, comments, bylines). Start here.
- **creating-plugins** -- Building EmDash plugins with hooks, storage, admin UI, API routes, and Portable Text block types.
- **emdash-cli** -- CLI commands for content management, seeding, type generation, and visual editing flow.

## Documentation

The EmDash docs are available as an MCP server at `https://docs.emdashcms.com/mcp`. When you need to verify an API, hook, config option, field type, or pattern, call `search_docs` against the live documentation rather than relying on training-data recall. The docs reflect current behaviour; assumptions may not.

This template ships with `.mcp.json`, `.cursor/mcp.json`, and `.vscode/mcp.json` so Claude Code, Cursor, and VS Code auto-discover the docs server. Other tools (OpenCode, Windsurf, etc.) need a manual one-time setup -- see [docs.emdashcms.com/docs-mcp](https://docs.emdashcms.com/docs-mcp).

## Rules

- All content pages must be server-rendered (`output: "server"`). No `getStaticPaths()` for CMS content.
- Image fields are objects (`{ src, alt }`), not strings. Use `<Image image={...} />` from `"emdash/ui"`.
- `entry.id` is the slug (for URLs). `entry.data.id` is the database ULID (for API calls like `getEntryTerms`).
- Always call `Astro.cache.set(cacheHint)` on pages that query content.
- Taxonomy names in queries must match the seed's `"name"` field exactly (e.g., `"category"` not `"categories"`).

### Learned the hard way (2026-07-28 outage — don't undo these)

- **A post must be linked to the taxonomy term in its own locale.** Terms are per-locale
  rows sharing a `translation_group`. The migration linked all 3766 posts to the EN term,
  so every TR/FR/ID archive returned 200 and rendered nothing — 1725 published posts
  invisible. When writing `content_taxonomies`, match `post.locale` to `term.locale`.
- **HTTP 200 is not proof a page works.** Any parity/verification gate you add must
  assert on rendered content, not just status. The crawl gate stayed green through the
  bug above for exactly this reason.
- **An archive URL is canonical in one locale only.** `getTerm` follows the locale
  fallback chain, so a TR slug also resolves under `/en/…`. The catch-all 301s those to
  the term's own archive; without it you get duplicate content and an hreflang cluster
  that omits the page emitting it.
- **hreflang must include the page itself**, and paginated archives emit none (sibling
  locales need not have the same page count). See `src/utils/hreflang.ts`.
- **`getTaxonomyTerms` is expensive** — each call runs a count aggregate over
  `content_taxonomies`, and the object cache is inert (no backend configured). Don't call
  it per-request on a hot path; `taxonomyAlternates` memoizes per isolate.
- Pages whose body already features search pass `headerSearch={false}` to `Base` so the
  header field isn't duplicated.
- The spacing scale is `1..6, 8, 10, 12, 16, 20, 24`. `var(--spacing-7)` and friends are
  undefined, and an undefined token silently voids the whole declaration.

### Learned porting the parallel branches (2026-07-28)

- **A redirect rule runs before routing, so it can delete a page.** Before adding to
  `redirects-data.mjs`, check every `from` against the live sitemap — the corpus grows, so a
  collision check that passed once is not evidence today. `redirects.test.ts` pins the live
  route shapes; extend it, don't bypass it.
- **A 301 into a 404 is worse than no redirect** — it spends the crawl and carries no
  equity. Verify destinations resolve, and never leave a chain (`A→B→C`) where `A→C` works.
- **Localizing user-visible copy can blind a gate.** The cutover gate reads the archive post
  count out of rendered HTML; translating that counter silently downgraded the content check
  to a status check. If a string is parsed anywhere, grep for the parser before changing it.
- **Don't port a workaround whose root cause is fixed.** The other branch reached related
  posts through a translation-group fan-out that existed only because posts were linked to
  the wrong locale's term. That is fixed in the data now, and the fan-out is the exact call
  that cost 4.2s of archive TTFB.
- The header's `primary` menu row exists only under locale `en` and holds the starter
  template's English "Home / Posts", so `getMenu("primary")` returns null on a TR request and
  the nav row is hidden by design. Resolving it across locales would put template English on
  a Turkish site — fix the menu content first, not the lookup.

## This Template _(template default — see the note at the top)_

A blog with posts, pages, categories, tags, full-text search, and RSS. Designed for personal writing, technical writing, indie newsletters, and anything where the writing is the product. Editorial-tech aesthetic: confident sans-serif, restrained accent, real article structure with bylines and reading time.

## Pages

Actual routing (preserved WordPress URLs). `{loc}` is `en|fr|id`; the TR equivalent of
every row is the same path without a prefix.

| Page              | Path                                              | Route file                            |
| ----------------- | ------------------------------------------------- | ------------------------------------- |
| TR home           | `/`                                               | `index.astro`                         |
| Language home     | `/{loc}/`                                         | `[...path].astro`                     |
| Post              | `/{slug}/` · `/{loc}/{slug}/`                     | `[...path].astro`                     |
| Page              | `/{slug}/` · `/{loc}/{slug}/`                     | `[...path].astro`                     |
| Category archive  | `/category/{slug}/` · `/{loc}/category/{slug}/`   | `[...path].astro`                     |
| Tag archive       | `/tag/{slug}/` · `/{loc}/tag/{slug}/`             | `[...path].astro`                     |
| Archive page N    | `…/category/{slug}/page/{n}/` (10 posts/page)     | `[...path].astro`                     |
| All posts         | `/posts` (24/page, keyset `?cursor=`)             | `posts/index.astro`                   |
| Search            | `/search`                                         | `search.astro`                        |
| Media (WP paths)  | `/wp-content/uploads/…`                           | `wp-content/uploads/[...path].ts`      |
| Sitemaps          | `/sitemap_index.xml`, `post-sitemap{n}.xml`, `page-sitemap{n}.xml`, `category-sitemap.xml` | `*.xml.ts` |
| RSS / robots / AI | `/rss.xml`, `/robots.txt`, `/llms.txt`, `/ai.txt` | matching files in `src/pages/`         |

Posts and pages share one flat slug namespace: the catch-all tries `posts` first, then
`pages`. An unresolved path is rendered through `Astro.rewrite("/404")` — a hard 404 at
the requested URL, never a redirect to `/404`.

Redirects run ahead of routing in `src/middleware.ts` (rules in
`src/lib/redirects-data.mjs`): 877 exact rules — migrated WP attachment pages, the Rank
Math export, category slug aliases — plus structural patterns that 301 `/page/N/`,
`/author/{slug}/` and any `…/feed/` to the home of their locale or to `/rss.xml`. One rule
is a 410. `/{collection}/{slug}` (EmDash search result links) 301s to the canonical path.

## Schema _(template default — see the note at the top)_

- `posts` collection: `title`, `featured_image`, `content` (Portable Text), `excerpt` (text).
- `pages` collection: `title`, `content` (Portable Text). Used for `/about` etc.
- Taxonomies: `category`, `tag`.
- Single `primary` menu (Home, About, Posts by default).

Site settings have `title` and `tagline` -- both render in the header / footer.

## Visual character _(template default — see the note at the top)_

Single typeface: **Inter** on `--font-sans`, used for everything including headings (with tighter letter-spacing on h1/h2). **JetBrains Mono** on `--font-mono` for inline code and code blocks. Body and headings share the same family; weight and size carry the hierarchy.

The accent is `#0066cc` -- used for links, the post-card title hover, and the search input focus ring. There's also a secondary text colour (`--color-text-secondary`) and a `--color-muted` for meta info. Don't add a second accent.

The article layout is the standout feature: a three-column reading view with a left meta column (author bylines, date), centred 680px body column, and a right gutter for search, table of contents, and categories. Don't flatten that into one column on desktop -- the layout signals "this is something to read".

## Customisation _(template default — see the note at the top)_

`src/styles/theme.css` is the only file to edit for visual changes. Every CSS variable from `Base.astro` is listed there as a commented default -- uncomment and change to override. The dark mode palette is defined inside `Base.astro` itself; light-mode overrides in `theme.css` won't affect dark mode. To customise dark mode, add `@media (prefers-color-scheme: dark)` and `:root.dark` rules in `theme.css`.

Fonts are configured in `astro.config.mjs` under `fonts:`. To swap the body face, change the `name:` for the entry bound to `cssVariable: "--font-sans"`. Good alternatives: Geist, IBM Plex Sans, Söhne (if you have a licence), Public Sans. If you want a serif-bodied blog, swap to a humanist serif like Source Serif, Crimson Pro, or Lora -- but then also raise `--font-size-base` to `1.0625rem` for readability.

CSS variables worth knowing:

- `--color-accent`, `--color-accent-hover`, `--color-on-accent`, `--color-accent-ring`
- `--color-bg`, `--color-bg-subtle`, `--color-surface`, `--color-text`, `--color-text-secondary`, `--color-muted`, `--color-border`, `--color-border-subtle`
- `--font-sans`, `--font-mono`
- `--tracking-tight` / `--tracking-snug` / `--tracking-wide` / `--tracking-wider` -- letter-spacing tokens used across headings and meta labels
- `--content-width` (680px) -- article body column
- `--wide-width` (1200px) -- max container
- `--gutter-width` (200px) -- right sidebar (TOC) on article pages
- `--meta-col-width` (180px) -- left meta column on article pages
- `--avatar-size-{xs,sm,md,lg}` -- byline avatar sizes at different scales

## What not to do _(template default — see the note at the top)_

- Don't add a second accent colour or coloured section backgrounds. The page should be black, white, and one blue.
- Don't replace Inter with a display sans (Bebas, Anton, etc.). Headings rely on weight contrast, not novelty faces.
- Don't collapse the article gutter on desktop -- it's part of the reading experience.
- Don't use stock blog copy ("Welcome to my blog", "Stay tuned for more"). Write a real tagline that says what this blog is about.
- Don't seed the home page with three identical placeholder posts. If you only have one real post, show one real post.
- Don't enable comments without a plan to moderate them. The template doesn't ship a comments system by default for a reason.
