import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  serialiseSparqlResults,
  WIKIDATA_QUERIES,
  wikidataSnapshotPath,
  type SparqlRow,
  type WikidataSnapshot,
} from "./wikidata.ts";

/** The CLDR release the Snapshots are taken from. Upgrading it is a reviewed data change (ADR-0008). */
export const CLDR_RELEASE = "release-49";

const CLDR_FILES = [
  "common/validity/region.xml",
  "common/supplemental/supplementalData.xml",
  "common/main/en.xml",
  "common/validity/subdivision.xml",
  "common/supplemental/subdivisions.xml",
  "common/subdivisions/en.xml",
];

/** Identifies the project to upstream servers by its repository URL only, never a personal address. */
const USER_AGENT = "geo-resolve-codegen (+https://github.com/conor-ob/geo-resolve)";

const WIKIDATA_SPARQL = "https://query.wikidata.org/sparql";

/**
 * Downloads the pinned CLDR release's files and writes them, unmodified, as Snapshots under `sourcesDir`, then runs
 * the Wikidata queries and writes their results, one row per line, since Wikidata can't be pinned (ADR-0008).
 */
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
  for (const [snapshot, query] of Object.entries(WIKIDATA_QUERIES) as [
    WikidataSnapshot,
    string,
  ][]) {
    const response = await fetch(WIKIDATA_SPARQL, {
      method: "POST",
      headers: {
        Accept: "application/sparql-results+json",
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT,
      },
      body: new URLSearchParams({ query }),
    });
    if (!response.ok)
      throw new Error(
        `Wikidata query ${snapshot} failed: ${response.status} ${response.statusText}`,
      );
    const results = (await response.json()) as {
      head: { vars: string[] };
      results: { bindings: SparqlRow[] };
    };
    const path = join(sourcesDir, wikidataSnapshotPath(snapshot));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, serialiseSparqlResults(results.head.vars, results.results.bindings));
  }
}
