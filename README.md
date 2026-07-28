# roadtostudy-com

[roadtostudy.com](https://roadtostudy.com) — a multilingual study-in-Turkey guide site,
migrated from WordPress (Polylang + Rank Math) onto EmDash + Astro running on Cloudflare
Workers, D1 and R2.

**Live in production since 2026-07-12.** DNS points at the Worker; WordPress is retired.

## Layout

| Path | What it is |
|---|---|
| `apps/site/` | The whole site (Astro + EmDash). All commands run from here. |
| `apps/site/AGENTS.md` | **Start here before changing code.** Routing, invariants, and the rules that came out of the 2026-07-28 incident. Symlinked as `CLAUDE.md`. |
| `docs/superpowers/plans/2026-07-11-cutover-runbook.md` | Cutover record, verified production numbers, and the post-cutover incident log. |
| `docs/superpowers/specs/2026-06-30-...-migration-design.md` | Original migration design and acceptance criteria. |
| `docs/superpowers/plans/2026-07-11-codex-handoff.md` | Historical — completed, must not be re-run. |

## Shape of the thing

- **4 locales:** `tr` (default, unprefixed), `en`, `fr`, `id`. WordPress URLs are preserved
  exactly: `/{slug}/` for Turkish, `/{locale}/{slug}/` for the rest, trailing slashes.
- **One catch-all route** (`src/pages/[...path].astro`) serves posts, pages, category and
  tag archives, `/page/N/` pagination and the localized homes.
- **Content lives in production D1** (~3.8k posts, 235 pages, 40 category terms), **media in
  R2**, served under the original `/wp-content/uploads/...` paths. The repo carries only the
  schema-only seed (`seed/runtime.json`); the full content seed is regenerable and untracked.
- **SEO parity is a requirement, not a goal.** Migrated pages emit the source Rank Math head
  verbatim. A diff against the source is treated as a regression.

## Commands

```bash
cd apps/site && npm run dev
```

```bash
cd apps/site && npm test && npx astro check
```

```bash
cd apps/site && npm run deploy
```

Before shipping anything that touches URLs, routing, or archives, run the cutover gate — it
checks that every sitemap URL resolves **and** that archives actually render posts:

```bash
cd apps/site && WP_TARGET_BASE=https://roadtostudy.com node scripts/wp-crawl-verify.mjs
```

Note that `npm run deploy` ships code and schema only. Content and media are not part of the
deploy; they live in D1 and R2 and are managed through the admin UI or the migration scripts.
