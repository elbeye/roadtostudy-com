// Migration-grade HTML -> Portable Text (spec §7.2). The post/page BODY renders from
// verbatim `content_html`, so this Portable Text is the structured fallback that also
// feeds reading-time and the search index — it must preserve real text structure, not
// flatten everything to plain paragraphs.
//
// Preserves: headings (h1-6, capped to h4 to match the template), paragraphs, ordered/
// unordered list items (listItem + level), blockquotes, and inline marks — links
// (markDefs) plus strong/em. Images/tables are intentionally left to `content_html`
// (they add nothing to reading-time or the text index).
//
// Output shape stays standard Portable Text so `getReadingTime`'s extractText (which
// reads block.children[].text) and emdash's <PortableText> renderer both consume it.

const HTML_ENTITIES = [
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
	[/&lt;/g, "<"],
	[/&gt;/g, ">"],
];

export function decodeHtml(value) {
	let out = String(value ?? "");
	for (const [re, rep] of HTML_ENTITIES) out = out.replace(re, rep);
	return out;
}

function href(attrs) {
	const m = attrs.match(/href\s*=\s*"([^"]*)"/i) || attrs.match(/href\s*=\s*'([^']*)'/i);
	return m ? decodeHtml(m[1]) : null;
}

// Convert an inline HTML fragment into Portable Text spans + link markDefs. Unknown
// tags are stripped (their text kept); <br> becomes a space.
export function inlineToSpans(html, keyBase) {
	const spans = [];
	const markDefs = [];
	const deco = new Set();
	let linkKey = null;
	let buf = "";
	let spanIdx = 0;

	const flush = () => {
		const text = decodeHtml(buf).replace(/\s+/g, " ");
		buf = "";
		if (text === "") return;
		const marks = [...deco];
		if (linkKey) marks.push(linkKey);
		spans.push({ _type: "span", _key: `${keyBase}s${spanIdx++}`, text, marks });
	};

	const re = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g;
	let last = 0;
	let m;
	while ((m = re.exec(html))) {
		buf += html.slice(last, m.index);
		last = re.lastIndex;
		const tag = m[1].toLowerCase();
		const closing = m[0].startsWith("</");
		const attrs = m[2] || "";
		if (tag === "strong" || tag === "b") {
			flush();
			closing ? deco.delete("strong") : deco.add("strong");
		} else if (tag === "em" || tag === "i") {
			flush();
			closing ? deco.delete("em") : deco.add("em");
		} else if (tag === "a") {
			flush();
			if (closing) {
				linkKey = null;
			} else {
				const url = href(attrs);
				if (url) {
					const key = `${keyBase}l${markDefs.length}`;
					markDefs.push({ _type: "link", _key: key, href: url });
					linkKey = key;
				} else {
					linkKey = null;
				}
			}
		} else if (tag === "br") {
			buf += " ";
		}
		// any other tag: strip, keep its text content
	}
	buf += html.slice(last);
	flush();
	return { spans, markDefs };
}

function textBlock({ style = "normal", spans, markDefs = [], listItem, level, key }) {
	const block = { _type: "block", _key: key, style, markDefs, children: spans };
	if (listItem) {
		block.listItem = listItem;
		block.level = level ?? 1;
	}
	return block;
}

function spanText(spans) {
	return spans.map((s) => s.text).join("");
}

// Block-level elements, matched in document order.
const BLOCK_RE =
	/<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1>|<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>|<(ul|ol)\b[^>]*>([\s\S]*?)<\/\4>|<p\b[^>]*>([\s\S]*?)<\/p>/gi;
const LI_RE = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;

export function htmlToPortableText(html) {
	const source = String(html ?? "");
	const blocks = [];
	let i = 0;

	const push = (opts) => {
		if (!spanText(opts.spans).trim()) return;
		blocks.push(textBlock({ ...opts, key: `b${i++}` }));
	};

	for (const m of source.matchAll(BLOCK_RE)) {
		const [, hTag, hInner, bqInner, listTag, listInner, pInner] = m;
		if (hTag) {
			const level = Math.min(Number(hTag.slice(1)), 4);
			push({ style: `h${level}`, ...inlineToSpans(hInner, `b${i}`) });
		} else if (bqInner !== undefined) {
			push({ style: "blockquote", ...inlineToSpans(bqInner, `b${i}`) });
		} else if (listTag) {
			const listItem = listTag.toLowerCase() === "ol" ? "number" : "bullet";
			for (const li of listInner.matchAll(LI_RE)) {
				push({ listItem, level: 1, ...inlineToSpans(li[1], `b${i}`) });
			}
		} else if (pInner !== undefined) {
			push({ style: "normal", ...inlineToSpans(pInner, `b${i}`) });
		}
	}

	// Fallback: no recognizable block structure — one normal block of stripped text.
	if (blocks.length === 0) {
		const { spans, markDefs } = inlineToSpans(source, "b0");
		if (spanText(spans).trim()) blocks.push(textBlock({ style: "normal", spans, markDefs, key: "b0" }));
	}

	return blocks;
}
