import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "./build.ts";
import {
  assessDataUpdate,
  dataUpdateChangeset,
  dataUpdatePrBody,
  dataUpdateTitle,
  SNAPSHOT_SOURCES,
  type SnapshotSource,
} from "./data-update.ts";
import { fetchSnapshots } from "./fetch.ts";
import { compareWithIsoCodes, fetchIsoCodes } from "./iso-codes.ts";

const sourcesDir = fileURLToPath(new URL("../sources", import.meta.url));
const overlayPath = fileURLToPath(new URL("../overlay.json", import.meta.url));
const allowlistPath = fileURLToPath(new URL("../iso-codes-allowlist.json", import.meta.url));
const reportPath = fileURLToPath(new URL("../build-report.md", import.meta.url));
const outDir = fileURLToPath(new URL("../../../packages/geo-resolve/src/data", import.meta.url));

const command = process.argv[2];
if (command === "fetch") await fetchSnapshots({ sourcesDir });
else if (command === "build") await build({ sourcesDir, overlayPath, outDir, reportPath });
else if (command === "compare-iso-codes")
  await compareWithIsoCodes({ dataDir: outDir, isoCodes: await fetchIsoCodes(), allowlistPath });
else if (command === "data-update" && process.argv.length >= 7) {
  const [beforeDir, buildReportDiffPath, snapshotDiffPath, updateDir, ...sources] =
    process.argv.slice(3) as [string, string, string, string, ...string[]];
  const unknown = sources.filter(
    (source) => !(SNAPSHOT_SOURCES as readonly string[]).includes(source),
  );
  if (unknown.length > 0) throw new Error(`Unknown Source ${unknown.join(", ")}`);
  const update = await assessDataUpdate({
    beforeDir,
    afterDir: outDir,
    sources: sources as SnapshotSource[],
  });
  await mkdir(updateDir, { recursive: true });
  const changeset = dataUpdateChangeset(update);
  if (changeset !== null) await writeFile(join(updateDir, "changeset.md"), changeset);
  await writeFile(join(updateDir, "title.txt"), `${dataUpdateTitle(update)}\n`);
  await writeFile(
    join(updateDir, "body.md"),
    dataUpdatePrBody(update, {
      buildReportDiff: await readFile(buildReportDiffPath, "utf8"),
      snapshotDiff: await readFile(snapshotDiffPath, "utf8"),
    }),
  );
  await writeFile(
    join(updateDir, "update.json"),
    `${JSON.stringify({ bump: update.bump, flagged: update.aliases.flagged })}\n`,
  );
  const { added, removed, flagged } = update.aliases;
  console.log(
    `${added.length} Aliases added, ${removed.length} removed${flagged ? " (flagged)" : ""}; changeset: ${changeset === null ? "none" : update.bump}`,
  );
} else {
  console.error(
    "Usage: node src/cli.ts <fetch|build|compare-iso-codes|data-update <before-dir> <build-report-diff> <snapshot-diff> <out-dir> [CLDR] [Wikidata]>",
  );
  process.exitCode = 1;
}
