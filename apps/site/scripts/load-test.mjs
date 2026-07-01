const baseUrl = process.env.BASE_URL || "http://127.0.0.1:4322";
const durationSeconds = Number(process.env.DURATION_SECONDS || 30);
const concurrency = Number(process.env.CONCURRENCY || 10);
const timeoutMs = Number(process.env.TIMEOUT_MS || 15000);
const urlList = (process.env.URLS || "/,/posts,/category/announcements,/_emdash/admin")
	.split(",")
	.map((url) => url.trim())
	.filter(Boolean);

const startedAt = Date.now();
const endsAt = startedAt + durationSeconds * 1000;
const results = [];

function percentile(values, p) {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
	return sorted[index];
}

async function hit(path) {
	const url = new URL(path, baseUrl);
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);
	const start = performance.now();

	try {
		const response = await fetch(url, {
			redirect: "manual",
			signal: controller.signal,
		});
		const body = await response.arrayBuffer();
		results.push({
			path,
			status: response.status,
			ok: response.status < 500,
			ms: performance.now() - start,
			bytes: body.byteLength,
		});
	} catch (error) {
		results.push({
			path,
			status: 0,
			ok: false,
			ms: performance.now() - start,
			bytes: 0,
			error: error instanceof Error ? error.name : "UnknownError",
		});
	} finally {
		clearTimeout(timeout);
	}
}

async function worker(offset) {
	let index = offset;
	while (Date.now() < endsAt) {
		await hit(urlList[index % urlList.length]);
		index += concurrency;
	}
}

await Promise.all(Array.from({ length: concurrency }, (_, index) => worker(index)));

const total = results.length;
const failures = results.filter((result) => !result.ok).length;
const latencies = results.map((result) => result.ms);
const elapsedSeconds = (Date.now() - startedAt) / 1000;
const byPath = new Map();

for (const result of results) {
	const current = byPath.get(result.path) || { count: 0, failures: 0, statuses: new Map() };
	current.count += 1;
	if (!result.ok) current.failures += 1;
	current.statuses.set(result.status, (current.statuses.get(result.status) || 0) + 1);
	byPath.set(result.path, current);
}

console.log(JSON.stringify({
	baseUrl,
	durationSeconds,
	concurrency,
	totalRequests: total,
	requestsPerSecond: Number((total / elapsedSeconds).toFixed(2)),
	failures,
	failureRate: total === 0 ? 0 : Number((failures / total).toFixed(4)),
	latencyMs: {
		p50: Number(percentile(latencies, 50).toFixed(1)),
		p90: Number(percentile(latencies, 90).toFixed(1)),
		p95: Number(percentile(latencies, 95).toFixed(1)),
		p99: Number(percentile(latencies, 99).toFixed(1)),
		max: Number(Math.max(0, ...latencies).toFixed(1)),
	},
	byPath: Object.fromEntries([...byPath.entries()].map(([path, value]) => [
		path,
		{
			count: value.count,
			failures: value.failures,
			statuses: Object.fromEntries(value.statuses),
		},
	])),
}, null, 2));

if (failures > 0) {
	process.exitCode = 1;
}
