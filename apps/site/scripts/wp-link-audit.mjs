// İç-link audit (§6.10): scan a WordPress export JSON for broken/malformed hrefs in
// post/page content HTML. The source corpus is known to contain stacked-scheme URLs
// (`https://https://roadtostudy.com//x`); this reports every detectable malformation
// and — since the conversion pipeline now repairs unambiguous ones via normalizeHref —
// also verifies each offender is actually fixed by that rule. Read-only apart from
// the report artifact.
//
// Detected issue types:
//   stacked-scheme      href starts with two (or more) schemes, e.g. https://https://…
//   doubled-slash-path  internal (roadtostudy.com) href with `//` right after the host
//   whitespace-in-url   absolute href containing literal whitespace
//   unparseable         absolute-looking href that new URL() rejects
//
// Offenders that are both whitespace-in-url and unparseable are prose pasted into
// href= — the pipeline unlinks those (drops the link, keeps the text) rather than
// rewriting them; they count as handled.
//
// Usage:
//   node scripts/wp-link-audit.mjs                    # data/wp-full.json, else data/wp-sample.json
//   node scripts/wp-link-audit.mjs data/wp-sample.json
//   WP_SAMPLE_INPUT=data/wp-full.json node scripts/wp-link-audit.mjs --json
//
// Writes data/link-audit.json (full offender list) + a console summary. Exits 1 only
// if an offender would NOT be repaired by the pipeline's normalizeHref rule.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { decodeHtml, isProseHref, normalizeHref } from "./html-to-portable-text.mjs";

const HREF_RE = /(?<![\w-])href\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const STACKED_SCHEME_RE = /^https?:\/\/https?:\/\//i;
const INTERNAL_DOUBLE_SLASH_RE = /^https?:\/\/(?:www\.)?roadtostudy\.com\/{2,}/i;
const ABSOLUTE_RE = /^https?:\/\//i;

// Every href attribute value in an HTML fragment, entity-decoded, in document order.
export function extractHrefs(html) {
	return [...String(html ?? "").matchAll(HREF_RE)].map((m) => decodeHtml(m[1] ?? m[2]));
}

// Classify one href. Returns [] for anything not *unambiguously* malformed — relative
// paths, anchors, mailto:, odd-but-valid external URLs all pass.
export function classifyHref(href) {
	const value = String(href ?? "");
	const issues = [];
	if (STACKED_SCHEME_RE.test(value)) issues.push("stacked-scheme");
	// Check the doubled slash on the scheme-collapsed form so stacked-scheme URLs
	// (whose raw form starts https://https://…) also surface this issue.
	const collapsed = value.replace(/^(https?:\/\/)+(?=https?:\/\/)/i, "");
	if (INTERNAL_DOUBLE_SLASH_RE.test(collapsed)) issues.push("doubled-slash-path");
	if (ABSOLUTE_RE.test(collapsed)) {
		if (/\s/.test(collapsed.trim())) issues.push("whitespace-in-url");
		try {
			new URL(collapsed.trim());
		} catch {
			issues.push("unparseable");
		}
	}
	return issues;
}

// Scan every post/page body (rendered + raw, the two fields the seed consumes) and
// return the offender list plus tallies.
export function auditExport(source) {
	const offenders = [];
	let hrefsScanned = 0;
	const scanned = { posts: 0, pages: 0 };

	for (const [collection, items] of [
		["posts", source.content?.posts || []],
		["pages", source.content?.pages || []],
	]) {
		for (const item of items) {
			scanned[collection]++;
			for (const field of ["rendered", "raw"]) {
				const html = item.content?.[field];
				if (!html) continue;
				for (const href of extractHrefs(html)) {
					hrefsScanned++;
					const issues = classifyHref(href);
					if (!issues.length) continue;
					const fixed = normalizeHref(href);
					// A prose href (sentence pasted into href=) is handled by unlinking,
					// not rewriting — the pipeline drops the link and keeps the text.
					const unlinked = isProseHref(fixed);
					offenders.push({
						collection,
						id: item.id,
						slug: item.slug,
						field,
						href,
						issues,
						fixed: unlinked ? null : fixed,
						unlinked,
						fixedIsClean: unlinked || classifyHref(fixed).length === 0,
					});
				}
			}
		}
	}

	const byType = {};
	for (const offender of offenders) {
		for (const issue of offender.issues) byType[issue] = (byType[issue] || 0) + 1;
	}
	const unfixed = offenders.filter((offender) => !offender.fixedIsClean);
	return { scanned, hrefsScanned, offenders, byType, unfixed };
}

function resolveInputPath() {
	if (process.env.WP_SAMPLE_INPUT) return process.env.WP_SAMPLE_INPUT;
	const cliArg = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
	if (cliArg) return cliArg;
	return existsSync("data/wp-full.json") ? "data/wp-full.json" : "data/wp-sample.json";
}

async function main() {
	const asJson = process.argv.includes("--json");
	const inputPath = resolveInputPath();
	const outputPath = process.env.WP_LINK_AUDIT_OUTPUT || "data/link-audit.json";

	const source = JSON.parse(await readFile(inputPath, "utf8"));
	const { scanned, hrefsScanned, offenders, byType, unfixed } = auditExport(source);

	const report = {
		inputPath,
		scanned,
		hrefsScanned,
		brokenHrefs: offenders.length,
		byType,
		unfixedByNormalizeHref: unfixed.length,
		offenders,
	};
	await mkdir(dirname(outputPath), { recursive: true });
	await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);

	const { offenders: _offenders, ...summary } = report;
	console.log(asJson ? JSON.stringify({ ...summary, outputPath }, null, 2) : renderSummary(report, outputPath));
	process.exitCode = unfixed.length > 0 ? 1 : 0;
}

function renderSummary(report, outputPath) {
	const types = Object.entries(report.byType)
		.sort((a, b) => b[1] - a[1])
		.map(([type, count]) => `  ${type}: ${count}`)
		.join("\n");
	const head =
		`Link audit: ${report.inputPath}\n` +
		`  scanned ${report.scanned.posts} posts, ${report.scanned.pages} pages | ${report.hrefsScanned} hrefs | broken ${report.brokenHrefs}`;
	if (!report.brokenHrefs) return `${head}\n  ✓ no malformed hrefs detected.\n  Report: ${outputPath}`;
	const seen = new Set();
	const samples = report.offenders
		.filter((o) => !seen.has(o.href) && seen.add(o.href))
		.slice(0, 10)
		.map((o) => `    [${o.collection}/${o.slug} ${o.field}] ${o.href}\n      -> ${o.unlinked ? "(unlinked — prose href)" : o.fixed}`);
	const fixNote =
		report.unfixedByNormalizeHref === 0
			? "  ✓ every offender is repaired (rewritten or unlinked) by the pipeline."
			: `  ✗ ${report.unfixedByNormalizeHref} offender(s) NOT handled by the pipeline — needs a new rule.`;
	return `${head}\n${types}\n  sample offenders (deduped, first 10):\n${samples.join("\n")}\n${fixNote}\n  Report: ${outputPath}`;
}

// Only run when invoked directly, so tests can import the pure helpers.
if (process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("wp-link-audit.mjs")) {
	await main();
}
