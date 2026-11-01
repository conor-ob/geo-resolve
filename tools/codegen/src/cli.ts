import { fileURLToPath } from "node:url";
import { build } from "./build.ts";
import { fetchSnapshots } from "./fetch.ts";

const sourcesDir = fileURLToPath(new URL("../sources", import.meta.url));
const outDir = fileURLToPath(new URL("../../../packages/geo-resolve/src/data", import.meta.url));

const command = process.argv[2];
if (command === "fetch") await fetchSnapshots({ sourcesDir });
else if (command === "build") await build({ sourcesDir, outDir });
else {
  console.error("Usage: node src/cli.ts <fetch|build>");
  process.exitCode = 1;
}
