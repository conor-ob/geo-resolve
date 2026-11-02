import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

/**
 * The Wikidata SPARQL queries `fetch` runs, keyed by the Snapshot each writes under `wikidata/`. Wikidata is read
 * only for Code systems and Aliases, joined to Entities built from CLDR; its ISO codes are join keys only (ADR-0001).
 */
export const WIKIDATA_QUERIES = {
  /** Every item holding an Alpha-2 code, so `build` can join Countries to items and find codes held by more than one. */
  items: `SELECT ?item ?alpha2 ?rank ?ended WHERE {
  ?item p:P297 ?statement .
  ?statement ps:P297 ?alpha2 ; wikibase:rank ?rank .
  BIND(EXISTS { ?statement pq:P582 [] } || EXISTS { ?item wdt:P576 [] } AS ?ended)
} ORDER BY ?alpha2 ?item`,

  /** Current IOC codes (P984) of items holding an Alpha-2 code. */
  ioc: `SELECT ?item ?ioc WHERE {
  ?item p:P297 [] ; p:P984 ?statement .
  ?statement ps:P984 ?ioc ; wikibase:rank ?rank .
  FILTER(?rank != wikibase:DeprecatedRank)
  FILTER NOT EXISTS { ?statement pq:P582 [] }
} ORDER BY ?item ?ioc`,

  /** English labels and aliases of items holding an Alpha-2 code. */
  aliases: `SELECT ?item ?alias WHERE {
  ?item p:P297 [] .
  { ?item rdfs:label ?alias } UNION { ?item skos:altLabel ?alias }
  FILTER(LANG(?alias) = "en")
} ORDER BY ?item ?alias`,

  /**
   * FIFA codes (P3441) of current FIFA members (P463 FIFA, Q253414) that aren't teams (Q12973014), with the
   * area each covers: its jurisdiction (P1001), operating area (P2541) or country (P17), and that area's
   * Subdivision code (P300), if any.
   */
  fifa: `SELECT ?association ?fifa ?property ?area ?subdivision WHERE {
  ?association p:P463 ?membership .
  ?membership ps:P463 wd:Q253414 .
  FILTER NOT EXISTS { ?membership pq:P582 [] }
  FILTER NOT EXISTS { ?association wdt:P31/wdt:P279* wd:Q12973014 }
  ?association wdt:P3441 ?fifa .
  OPTIONAL {
    { ?association wdt:P1001 ?area . BIND("P1001" AS ?property) }
    UNION { ?association wdt:P2541 ?area . BIND("P2541" AS ?property) }
    UNION { ?association wdt:P17 ?area . BIND("P17" AS ?property) }
    OPTIONAL { ?area wdt:P300 ?subdivision }
  }
} ORDER BY ?association ?fifa ?property ?area ?subdivision`,
} as const;

export type WikidataSnapshot = keyof typeof WIKIDATA_QUERIES;

/** Where a Wikidata Snapshot sits under the Snapshot directory. */
export function wikidataSnapshotPath(snapshot: WikidataSnapshot): string {
  return join("wikidata", `${snapshot}.json`);
}

/** One SPARQL result row: each bound variable's value, as SPARQL's JSON results format writes it. */
export type SparqlRow = Record<string, { type: string; value: string; "xml:lang"?: string }>;

const SparqlResultsSchema = z.object({
  head: z.object({ vars: z.array(z.string()) }),
  results: z.object({
    bindings: z.array(
      z.record(
        z.string(),
        z.object({ type: z.string(), value: z.string(), "xml:lang": z.string().optional() }),
      ),
    ),
  }),
});

/**
 * Serialises SPARQL JSON results with one row per line and each row's variables in query order, so a weekly `fetch`
 * diffs row by row. The rows keep the order the query's `ORDER BY` gave them.
 */
export function serialiseSparqlResults(
  vars: readonly string[],
  rows: readonly SparqlRow[],
): string {
  const lines = rows.map((row) =>
    JSON.stringify(
      Object.fromEntries(vars.flatMap((name) => (row[name] ? [[name, row[name]]] : []))),
    ),
  );
  return `{"head":${JSON.stringify({ vars })},"results":{"bindings":[\n${lines.join(",\n")}\n]}}\n`;
}

/** Turns a Wikidata entity URI such as `http://www.wikidata.org/entity/Q183` into its id, `Q183`. */
function itemId(uri: string): string {
  return uri.slice(uri.lastIndexOf("/") + 1);
}

/** Reads a Wikidata Snapshot's rows as plain strings, with entity URIs shortened to item ids. */
async function readRows<T extends z.ZodType>(
  sourcesDir: string,
  snapshot: WikidataSnapshot,
  rowSchema: T,
): Promise<z.infer<T>[]> {
  const path = wikidataSnapshotPath(snapshot);
  const results = SparqlResultsSchema.safeParse(
    JSON.parse(await readFile(join(sourcesDir, path), "utf8")),
  );
  if (!results.success)
    throw new Error(`Snapshot ${path} is malformed:\n${z.prettifyError(results.error)}`);
  const rows = z
    .array(rowSchema)
    .safeParse(
      results.data.results.bindings.map((row) =>
        Object.fromEntries(
          Object.entries(row).map(([name, { type, value }]) => [
            name,
            type === "uri" ? itemId(value) : value,
          ]),
        ),
      ),
    );
  if (!rows.success)
    throw new Error(`Snapshot ${path} is malformed:\n${z.prettifyError(rows.error)}`);
  return rows.data;
}

export const ItemIdSchema = z.string().regex(/^Q\d+$/, "must be a Wikidata item id");

/** The FIFA association properties that say which area it covers, most specific first. */
export const COVERAGE_PROPERTIES = ["P1001", "P2541", "P17"] as const;

/** The Wikidata Snapshots, validated and with item URIs shortened to ids such as `Q183`. */
export interface Wikidata {
  /** Items holding an Alpha-2 code, with whether that statement is deprecated or the item or statement has ended. */
  items: { item: string; alpha2: string; current: boolean }[];
  ioc: { item: string; ioc: string }[];
  aliases: { item: string; alias: string }[];
  fifa: {
    association: string;
    fifa: string;
    property?: (typeof COVERAGE_PROPERTIES)[number];
    area?: string;
    subdivision?: string;
  }[];
}

/** Reads and validates the Wikidata Snapshots `fetch` wrote under `sourcesDir`. */
export async function readWikidata(sourcesDir: string): Promise<Wikidata> {
  const items = await readRows(
    sourcesDir,
    "items",
    z.object({
      item: ItemIdSchema,
      alpha2: z.string(),
      rank: z.string(),
      ended: z.enum(["true", "false"]),
    }),
  );
  return {
    items: items.map(({ item, alpha2, rank, ended }) => ({
      item,
      alpha2,
      current: ended === "false" && !rank.endsWith("#DeprecatedRank"),
    })),
    ioc: await readRows(sourcesDir, "ioc", z.object({ item: ItemIdSchema, ioc: z.string() })),
    aliases: await readRows(
      sourcesDir,
      "aliases",
      z.object({ item: ItemIdSchema, alias: z.string() }),
    ),
    fifa: await readRows(
      sourcesDir,
      "fifa",
      z.object({
        association: ItemIdSchema,
        fifa: z.string(),
        property: z.enum(COVERAGE_PROPERTIES).optional(),
        area: ItemIdSchema.optional(),
        subdivision: z.string().optional(),
      }),
    ),
  };
}
