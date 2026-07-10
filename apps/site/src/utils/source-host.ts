// Rewrites absolute links to the migrated WordPress origin so in-body URLs (and
// verbatim JSON-LD) resolve on the current host pre-cutover and stay identical at
// cutover (origin === roadtostudy.com then). The source export contains both
// https:// and http:// links, with and without the www. host (see the migrated
// bodies in data/d1-update-sql/*.sql), so match all four shapes — a plain
// replaceAll("https://roadtostudy.com", …) misses http:// and www. variants and
// leaves them pointing at the old site.
const SOURCE_HOST_RE = /https?:\/\/(?:www\.)?roadtostudy\.com/g;

export function rewriteSourceHost(input: string | null | undefined, origin: string): string {
	// Function replacement avoids `$`-pattern interpretation in the origin string.
	return (input || "").replace(SOURCE_HOST_RE, () => origin);
}
