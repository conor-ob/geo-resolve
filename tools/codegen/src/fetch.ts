import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/** The CLDR release the Snapshots are taken from. Upgrading it is a reviewed data change (ADR-0008). */
export const CLDR_RELEASE = "release-49";

const CLDR_FILES = [
  "common/validity/region.xml",
  "common/supplemental/supplementalData.xml",
  "common/main/en.xml",
];

/** Identifies the project to upstream servers by its repository URL only, never a personal address. */
const USER_AGENT = "geo-resolve-codegen (+https://github.com/conor-ob/geo-resolve)";

/** Downloads the pinned CLDR release's files and writes them, unmodified, as Snapshots under `sourcesDir`. */
export async function fetchSnapshots({ sourcesDir }: { sourcesDir: string }): Promise<void> {
  for (const file of CLDR_FILES) {
    const url = `https://raw.githubusercontent.com/unicode-org/cldr/${CLDR_RELEASE}/${file}`;
    const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!response.ok)
      throw new Error(`GET ${url} failed: ${response.status} ${response.statusText}`);
    const path = join(sourcesDir, "cldr", file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, Buffer.from(await response.arrayBuffer()));
  }
}
