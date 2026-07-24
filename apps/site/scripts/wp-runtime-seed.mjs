import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const inputPath = process.env.WP_FULL_SEED_INPUT || "seed/seed.json";
const outputPath = process.env.WP_RUNTIME_SEED_OUTPUT || "seed/runtime.json";

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
