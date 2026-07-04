import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { collectMediaUrls, r2KeyFromUrl } from "./wp-media-lib.mjs";

const inputPath = process.env.WP_SAMPLE_INPUT || "data/wp-sample.json";
const baseUrl = process.env.WP_BASE_URL || "https://roadtostudy.com";
const outputPath = process.env.WP_MEDIA_SIZE_REPORT || "data/media-size-report.json";
const concurrency = Math.max(1, Number(process.env.WP_MEDIA_SIZE_CONCURRENCY || 8));
const timeoutMs = Math.max(1000, Number(process.env.WP_MEDIA_SIZE_TIMEOUT_MS || 10000));
const maxStorageBytes = Math.max(1, Number(process.env.WP_R2_MAX_STORAGE_BYTES || 10 * 1024 * 1024 * 1024));
const refresh = process.argv.includes("--refresh");

const source = JSON.parse(await readFile(inputPath, "utf8"));
const urls = collectMediaUrls(source, { baseUrl });
const existing = !refresh && existsSync(outputPath) ? JSON.parse(await readFile(outputPath, "utf8")) : null;
const previousByKey = new Map((existing?.items || []).map((item) => [item.key, item]));
const items = [];

async function measure(url) {
	const key = r2KeyFromUrl(url, { baseUrl });
	if (!key) return { url, key: null, status: "skipped" };
	const cached = previousByKey.get(key);
	if (cached?.status === "ok") return cached;

	try {
		const signal = AbortSignal.timeout(timeoutMs);
		const head = await fetch(url, { method: "HEAD", redirect: "follow", signal });
		if (!head.ok) return { url, key, status: "failed", httpStatus: head.status };
		const length = Number(head.headers.get("content-length") || 0);
		const contentType = head.headers.get("content-type") || null;
		return Number.isFinite(length) && length > 0
			? { url, key, status: "ok", bytes: length, contentType }
			: { url, key, status: "unknown-size", contentType };
	} catch (error) {
		return { url, key, status: "failed", error: String(error) };
	}
}

async function runPool(values, worker) {
	let index = 0;
	let completed = 0;
	const runners = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
		while (index < values.length) {
			const current = values[index++];
			items.push(await worker(current));
			completed++;
			if (completed % 250 === 0) {
				console.error(`Measured ${completed}/${values.length}`);
			}
		}
	});
	await Promise.all(runners);
}

await runPool(urls, measure);
items.sort((a, b) => String(a.key).localeCompare(String(b.key)));

const knownBytes = items.reduce((sum, item) => sum + (item.status === "ok" ? item.bytes || 0 : 0), 0);
const report = {
	inputPath,
	baseUrl,
	total: urls.length,
	knownBytes,
	knownMb: Number((knownBytes / 1024 / 1024).toFixed(1)),
	knownGb: Number((knownBytes / 1024 / 1024 / 1024).toFixed(3)),
	maxStorageBytes,
	maxStorageGb: Number((maxStorageBytes / 1024 / 1024 / 1024).toFixed(1)),
	overStorageGuard: knownBytes > maxStorageBytes,
	statuses: tally(items.map((item) => item.status)),
	unknownOrFailed: items
		.filter((item) => item.status !== "ok" && item.status !== "skipped")
		.slice(0, 20)
		.map((item) => ({ key: item.key, status: item.status, httpStatus: item.httpStatus, error: item.error })),
	items,
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);

const { items: _items, ...summary } = report;
console.log(JSON.stringify({ ...summary, outputPath }, null, 2));
if (report.overStorageGuard || report.statuses.failed || report.statuses["unknown-size"]) process.exit(2);

function tally(values) {
	const out = {};
	for (const value of values) out[value] = (out[value] || 0) + 1;
	return out;
}
