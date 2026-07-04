import { readFile, writeFile, unlink } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { collectMediaUrls, r2KeyFromUrl, contentTypeForKey } from "./wp-media-lib.mjs";

const execFileAsync = promisify(execFile);

const inputPath = process.env.WP_SAMPLE_INPUT || "data/wp-sample.json";
const baseUrl = process.env.WP_BASE_URL || "https://roadtostudy.com";
const bucket = process.env.R2_BUCKET || "roadtostudy-emdash-media-poc";
const concurrency = Math.max(1, Number(process.env.WP_MEDIA_CONCURRENCY || 4));
const dryRun = process.argv.includes("--dry-run");
const confirmCost = process.argv.includes("--confirm-cost") || process.env.WP_COST_GUARD_ACK === "1";
const maxObjects = Math.max(1, Number(process.env.WP_MEDIA_MAX_OBJECTS || 1000));
const maxEstimatedClassA = Math.max(1, Number(process.env.WP_MEDIA_MAX_CLASS_A_OPS || 100000));
const maxEstimatedClassB = Math.max(1, Number(process.env.WP_MEDIA_MAX_CLASS_B_OPS || 1000000));

const source = JSON.parse(await readFile(inputPath, "utf8"));
const urls = collectMediaUrls(source, { baseUrl });
const estimatedClassAOps = urls.length;
const estimatedClassBOps = urls.length * 10;
const guard = {
	maxObjects,
	maxEstimatedClassA,
	maxEstimatedClassB,
	estimatedClassAOps,
	estimatedClassBOps,
	requiresConfirmation: urls.length > maxObjects,
	confirmed: confirmCost,
};

if (dryRun) {
	console.log(
		JSON.stringify(
			{
				dryRun: true,
				total: urls.length,
				bucket,
				guard,
				sampleKeys: urls.slice(0, 5).map((u) => r2KeyFromUrl(u, { baseUrl })),
			},
			null,
			2,
		),
	);
	process.exit(0);
}

if (urls.length > maxObjects && !confirmCost) {
	console.error(
		JSON.stringify(
			{
				error: "COST_GUARD_CONFIRMATION_REQUIRED",
				message:
					"Upload set exceeds WP_MEDIA_MAX_OBJECTS. Re-run with --confirm-cost or WP_COST_GUARD_ACK=1 after checking R2 Standard storage stays under the free 10 GB-month tier.",
				total: urls.length,
				bucket,
				guard,
			},
			null,
			2,
		),
	);
	process.exit(2);
}

if (estimatedClassAOps > maxEstimatedClassA || estimatedClassBOps > maxEstimatedClassB) {
	console.error(
		JSON.stringify(
			{
				error: "COST_GUARD_OPERATION_LIMIT",
				message: "Estimated R2 operations exceed configured guardrail limits.",
				total: urls.length,
				bucket,
				guard,
			},
			null,
			2,
		),
	);
	process.exit(2);
}

// Run `wrangler r2 object ...` as a subprocess. Auth comes from CLOUDFLARE_API_TOKEN
// in the environment (already loaded via `node --env-file=.env`) — never logged here.
async function runWrangler(args) {
	return execFileAsync("npx", ["wrangler", ...args], { maxBuffer: 1024 * 1024 * 64 });
}

async function exists(key) {
	try {
		await runWrangler(["r2", "object", "get", `${bucket}/${key}`, "--remote", "--pipe"]);
		return true;
	} catch (error) {
		const stderr = String(error?.stderr || "");
		if (/does not exist|not found|404/i.test(stderr)) return false;
		throw new Error(`get ${key} -> ${error?.code ?? "error"}: ${stderr.trim() || error.message}`);
	}
}

// R2 is read-after-write consistent, but a freshly-PUT object can briefly be
// invisible to an immediate GET on a different edge. The verify pass runs right
// after upload, so retry a few times before declaring a key missing (a genuinely
// missing key still costs only attempts*delay once).
async function existsWithRetry(key, attempts = 8, delayMs = 3000) {
	for (let i = 0; i < attempts; i++) {
		if (await exists(key)) return true;
		if (i < attempts - 1) await new Promise((resolve) => setTimeout(resolve, delayMs));
	}
	return false;
}

async function upload(url) {
	let key;
	let tmpFile;
	try {
		key = r2KeyFromUrl(url, { baseUrl });
		if (!key) return { key: url, status: "skipped-nonuploads" };

		if (await exists(key)) return { key, status: "skipped-exists" };

		const download = await fetch(url);
		if (!download.ok) return { key, status: "failed", error: `download ${download.status}` };
		const bytes = new Uint8Array(await download.arrayBuffer());

		const contentType = download.headers.get("content-type") || contentTypeForKey(key);
		tmpFile = join(tmpdir(), `wp-media-${randomUUID()}`);
		await writeFile(tmpFile, bytes);

		try {
			await runWrangler([
				"r2",
				"object",
				"put",
				`${bucket}/${key}`,
				"--remote",
				"--file",
				tmpFile,
				"--content-type",
				contentType,
			]);
		} catch (error) {
			const stderr = String(error?.stderr || error.message).trim();
			return { key, status: "failed", error: `put ${stderr}` };
		}

		return { key, status: "uploaded" };
	} catch (error) {
		return { key: key || url, status: "failed", error: String(error) };
	} finally {
		if (tmpFile) {
			await unlink(tmpFile).catch(() => {});
		}
	}
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

// Verify: every intended key now exists in R2.
const verify = await runPool(urls, async (url) => {
	const key = r2KeyFromUrl(url, { baseUrl });
	if (!key) return { key: url, ok: true };
	try {
		return { key, ok: await existsWithRetry(key) };
	} catch (error) {
		return { key, ok: false, error: String(error) };
	}
});
summary.verifiedOk = verify.filter((v) => v.ok).length;
summary.verifyFailed = verify.filter((v) => !v.ok);

console.log(JSON.stringify(summary, null, 2));
if (summary.failed.length > 0 || summary.verifyFailed.length > 0) process.exit(1);
