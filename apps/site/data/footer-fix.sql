-- Fix leftover EmDash starter-template copy in production site settings.
--
-- Root cause: `getSiteSettings().tagline` reads the `options` table row named
-- 'site:tagline'. `seed/seed.json` already declares the correct tagline
-- ("Study in Turkey guides for international students"), but the live
-- production D1 database's `options` row was set during initial setup
-- (before the seed content was customised) and never got updated to match.
-- It still holds the EmDash starter blog's default copy: "A blog about
-- software, design, and the occasional stray thought." — which is what
-- rendered in the site footer.
--
-- This is a single global (non-locale-aware) setting, so it can't correctly
-- describe the site in all four languages (tr/en/fr/id). The footer itself no
-- longer reads this value directly (src/layouts/Base.astro now renders a
-- small per-locale copy dict instead, see CHROME_COPY there) — but the
-- underlying `options` row is still used elsewhere (e.g. as a default meta
-- description / in the admin UI), so it should be corrected at the source too.
--
-- Apply against the production D1 database, e.g.:
--   wrangler d1 execute <DB_NAME> --remote --file=data/footer-fix.sql
--
-- (Not run here — per instructions, no wrangler/DB commands were executed as
-- part of this change. `value` is stored JSON-encoded, matching the existing
-- row format.)
UPDATE options
SET value = '"Study in Turkey guides for international students"'
WHERE name = 'site:tagline';
