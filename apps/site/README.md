# EmDash Blog Template (Cloudflare)

A clean, minimal blog built with [EmDash](https://github.com/emdash-cms/emdash) and deployed on Cloudflare Workers with D1 and R2.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/emdash-cms/templates/tree/main/blog-cloudflare)

![Blog template homepage](https://raw.githubusercontent.com/emdash-cms/emdash/main/assets/templates/blog/latest/homepage-light-desktop.jpg)

## What's Included

- Featured post hero on the homepage
- Post archive with reading time estimates
- Category and tag archives
- Full-text search
- RSS feed
- SEO metadata and JSON-LD
- Dark/light mode
- Forms plugin and webhook notifier

## Pages

| Page | Route |
|---|---|
| Homepage | `/` |
| All posts | `/posts` |
| Single post | `/posts/:slug` |
| Category archive | `/category/:slug` |
| Tag archive | `/tag/:slug` |
| Search | `/search` |
| Static pages | `/pages/:slug` |
| 404 | fallback |

## Screenshots

| | Desktop | Mobile |
|---|---|---|
| Light | ![homepage light desktop](https://raw.githubusercontent.com/emdash-cms/emdash/main/assets/templates/blog/latest/homepage-light-desktop.jpg) | ![homepage light mobile](https://raw.githubusercontent.com/emdash-cms/emdash/main/assets/templates/blog/latest/homepage-light-mobile.jpg) |
| Dark | ![homepage dark desktop](https://raw.githubusercontent.com/emdash-cms/emdash/main/assets/templates/blog/latest/homepage-dark-desktop.jpg) | ![homepage dark mobile](https://raw.githubusercontent.com/emdash-cms/emdash/main/assets/templates/blog/latest/homepage-dark-mobile.jpg) |

## Infrastructure

- **Runtime:** Cloudflare Workers
- **Database:** D1
- **Storage:** R2
- **Framework:** Astro with `@astrojs/cloudflare`

## Local Development

```bash
pnpm install
pnpm bootstrap
pnpm dev
```

## WordPress Migration Guardrails

Full media upload is guarded so a large R2 write set cannot run by accident.

```bash
WP_SEED_INPUT=/private/tmp/wp-full-seed.json npm run wp:seed:preflight
npm run media:dry-run:full
npm run media:size:full
WP_MEDIA_LIMIT=25 npm run media:dry-run:full
npm run media:upload:full              # stops if the set exceeds WP_MEDIA_MAX_OBJECTS
npm run media:upload:full:confirmed    # only after confirming R2 Standard storage stays under 10 GB-month
```

Defaults:

- `WP_MEDIA_MAX_OBJECTS=1000`
- `WP_MEDIA_MAX_CLASS_A_OPS=100000`
- `WP_MEDIA_MAX_CLASS_B_OPS=1000000`
- `WP_R2_MAX_STORAGE_BYTES=10737418240` (10 GB)
- `WP_SEED_MAX_BYTES=209715200` (200 MB)
- `WP_D1_MAX_ESTIMATED_ROWS_WRITTEN=90000`

The current full export dry-run finds 4496 R2 keys, so it requires explicit confirmation before upload.

## Deploying

```bash
pnpm deploy
```

Or click the deploy button above to set up the project in your Cloudflare account.

## See Also

- [Node.js variant](../blog) -- same template using SQLite and local file storage
- [All templates](../)
- [EmDash documentation](https://github.com/emdash-cms/emdash/tree/main/docs)
