import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const inputPath = process.env.WP_FULL_SEED_INPUT || "seed/seed.json";
const outputPath = process.env.WP_RUNTIME_SEED_OUTPUT || "seed/runtime.json";

const exists = async (path) => {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
};

// `npm run build`/`deploy` call this first, but the full seed (seed/seed.json, ~186MB
// of migrated post bodies) is a regenerable artifact and is NOT in the repo — only the
// schema-only output (seed/runtime.json) is. On a fresh clone the input is therefore
// absent while the output is already committed, so regeneration is a no-op: skip it
// rather than failing the build. Only a missing input AND missing output is fatal.
if (!(await exists(inputPath))) {
	if (await exists(outputPath)) {
		console.log(
			JSON.stringify(
				{ skipped: true, reason: `${inputPath} not present; using committed ${outputPath}` },
				null,
				2,
			),
		);
		process.exit(0);
	}
	console.error(
		`Cannot build the runtime seed: neither ${inputPath} nor ${outputPath} exists.\n` +
			`Regenerate the full seed with \`npm run wp:seed:full\` (needs data/wp-full.json from \`npm run wp:full\`),\n` +
			`or restore ${outputPath} from git.`,
	);
	process.exit(1);
}

const fullSeed = JSON.parse(await readFile(inputPath, "utf8"));

const runtimeSeed = {
	$schema: fullSeed.$schema,
	version: fullSeed.version,
	meta: {
		...(fullSeed.meta || {}),
		name: `${fullSeed.meta?.name || "RoadToStudy"} Runtime Schema`,
		description:
			"Schema-only runtime seed. Full migrated WordPress content is loaded into D1 with the migration SQL pipeline.",
	},
	settings: fullSeed.settings,
	collections: fullSeed.collections,
	taxonomies: fullSeed.taxonomies,
	bylines: fullSeed.bylines,
	menus: fullSeed.menus,
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(runtimeSeed, null, 2)}\n`);

const fullContent = fullSeed.content || {};
console.log(
	JSON.stringify(
		{
			outputPath,
			sourceSeedBytes: Buffer.byteLength(JSON.stringify(fullSeed)),
			runtimeSeedBytes: Buffer.byteLength(JSON.stringify(runtimeSeed)),
			omittedContent: Object.fromEntries(
				Object.entries(fullContent).map(([collection, entries]) => [
					collection,
					Array.isArray(entries) ? entries.length : 0,
				]),
			),
		},
		null,
		2,
	),
);
