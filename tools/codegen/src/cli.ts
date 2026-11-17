import { fileURLToPath } from "node:url";
import { checkAliasChanges } from "./alias-changes.ts";
import { build } from "./build.ts";
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
else if (command === "alias-changes" && process.argv.length === 5) {
  const [beforeDir, warningPath] = process.argv.slice(3) as [string, string];
  const { added, removed, flagged } = await checkAliasChanges({
    beforeDir,
    afterDir: outDir,
    warningPath,
  });
  console.log(
    `${added.length} Aliases added, ${removed.length} removed${flagged ? `: flagged, see ${warningPath}` : ""}`,
  );
} else {
  console.error(
    "Usage: node src/cli.ts <fetch|build|compare-iso-codes|alias-changes <before-dir> <warning-path>>",
  );
  process.exitCode = 1;
}
