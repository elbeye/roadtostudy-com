// Shared XML entity escaping for the sitemap and RSS builders (previously duplicated
// in src/lib/sitemap.ts and src/pages/rss.xml.ts).
const XML_ESCAPE: ReadonlyArray<readonly [RegExp, string]> = [
	[/&/g, "&amp;"],
	[/</g, "&lt;"],
	[/>/g, "&gt;"],
	[/"/g, "&quot;"],
	[/'/g, "&apos;"],
];

export function escapeXml(str: string): string {
	let out = str;
	for (const [re, rep] of XML_ESCAPE) out = out.replace(re, rep);
	return out;
}
