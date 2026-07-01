import { readFile } from "node:fs/promises";
import { AwsClient } from "aws4fetch";
import { collectMediaUrls, r2KeyFromUrl, contentTypeForKey } from "./wp-media-lib.mjs";

const inputPath = process.env.WP_SAMPLE_INPUT || "data/wp-sample.json";
const baseUrl = process.env.WP_BASE_URL || "https://roadtostudy.com";
const bucket = process.env.R2_BUCKET || "roadtostudy-emdash-media-poc";
const concurrency = Math.max(1, Number(process.env.WP_MEDIA_CONCURRENCY || 8));
const dryRun = process.argv.includes("--dry-run");

const source = JSON.parse(await readFile(inputPath, "utf8"));
const urls = collectMediaUrls(source, { baseUrl });

if (dryRun) {
	console.log(
		JSON.stringify(
			{ dryRun: true, total: urls.length, sampleKeys: urls.slice(0, 5).map((u) => r2KeyFromUrl(u, { baseUrl })) },
			null,
			2,
		),
	);
	process.exit(0);
}

const accountId = requireEnv("R2_ACCOUNT_ID");
const accessKeyId = requireEnv("R2_ACCESS_KEY_ID");
const secretAccessKey = requireEnv("R2_SECRET_ACCESS_KEY");
const endpoint = `https://${accountId}.r2.cloudflarestorage.com/${bucket}`;
const aws = new AwsClient({ accessKeyId, secretAccessKey, service: "s3", region: "auto" });

function requireEnv(name) {
	const value = process.env[name];
	if (!value) throw new Error(`${name} must be set (see plan Prerequisites).`);
	return value;
}

function objectUrl(key) {
	return `${endpoint}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

async function exists(key) {
	const res = await aws.fetch(objectUrl(key), { method: "HEAD" });
	if (res.status === 200) return true;
	if (res.status === 404) return false;
	throw new Error(`HEAD ${key} -> ${res.status}`);
}

async function upload(url) {
	const key = r2KeyFromUrl(url, { baseUrl });
	if (!key) return { key: url, status: "skipped-nonuploads" };

	if (await exists(key)) return { key, status: "skipped-exists" };

	const download = await fetch(url);
	if (!download.ok) return { key, status: "failed", error: `download ${download.status}` };
	const bytes = new Uint8Array(await download.arrayBuffer());

	const put = await aws.fetch(objectUrl(key), {
		method: "PUT",
		body: bytes,
		headers: { "Content-Type": download.headers.get("content-type") || contentTypeForKey(key) },
	});
	if (!put.ok) return { key, status: "failed", error: `put ${put.status}` };
	return { key, status: "uploaded" };
}

async function runPool(items, worker) {
	const results = [];
	let index = 0;
	const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
		while (index < items.length) {
			const current = items[index++];
			results.push(await worker(current));
		}
	});
	await Promise.all(runners);
	return results;
}

const results = await runPool(urls, upload);

const summary = {
	total: urls.length,
	uploaded: results.filter((r) => r.status === "uploaded").length,
	skipped: results.filter((r) => r.status.startsWith("skipped")).length,
	failed: results.filter((r) => r.status === "failed"),
};

// Verify: every intended key now returns 200 from R2.
const verify = await runPool(urls, async (url) => {
	const key = r2KeyFromUrl(url, { baseUrl });
	if (!key) return { key: url, ok: true };
	try {
		return { key, ok: await exists(key) };
	} catch (error) {
		return { key, ok: false, error: String(error) };
	}
});
summary.verifiedOk = verify.filter((v) => v.ok).length;
summary.verifyFailed = verify.filter((v) => !v.ok);

console.log(JSON.stringify(summary, null, 2));
if (summary.failed.length > 0 || summary.verifyFailed.length > 0) process.exit(1);
