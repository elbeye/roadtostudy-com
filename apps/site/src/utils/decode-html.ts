// Minimal HTML entity decoder for migrated WordPress text fields (e.g. `excerpt`).
// WordPress excerpts often carry un-decoded numeric/named entities (e.g. "&#8230;"
// for the ellipsis) left over from migration. Astro's `{expr}` interpolation
// HTML-escapes its output rather than decoding existing entities, so an
// undecoded entity round-trips to the page as literal text ("&#8230;") instead
// of the character it names ("…"). Mirrors the entity table in
// scripts/html-to-portable-text.mjs, but lives under src/utils/ so pages and
// components can import it without reaching into scripts/ (which isn't part of
// the site build).
const HTML_ENTITIES: ReadonlyArray<readonly [RegExp, string]> = [
	[/&nbsp;/g, " "],
	[/&amp;/g, "&"],
	[/&quot;/g, '"'],
	[/&#0?39;/g, "'"],
	[/&#8217;/g, "'"],
	[/&#8216;/g, "'"],
	[/&#8220;/g, '"'],
	[/&#8221;/g, '"'],
	[/&#8211;/g, "-"],
	[/&#8212;/g, "-"],
	[/&hellip;/g, "…"],
	[/&#8230;/g, "…"],
	[/&lt;/g, "<"],
	[/&gt;/g, ">"],
];

export function decodeHtml(value: string | null | undefined): string {
	let out = String(value ?? "");
	for (const [re, rep] of HTML_ENTITIES) out = out.replace(re, rep);
	return out;
}
