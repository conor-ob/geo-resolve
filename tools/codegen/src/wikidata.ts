import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Country, Subdivision } from "geo-resolve";
import type { AliasCandidate } from "./alias-rules.ts";
import { z } from "zod";
import { CODE_SYSTEM_KEYS, CODE_SYSTEMS, type CodeSystem } from "./code-systems.ts";
import { append } from "./lists.ts";
import type { Overlay } from "./overlay.ts";
import { ItemIdSchema } from "./schemas.ts";

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

  /**
   * Current IOC codes (P984) of items holding an Alpha-2 code. `DISTINCT`, since an item holding a former Alpha-2
   * code too, such as Myanmar (MM and BU), matches once per code.
   */
  ioc: `SELECT DISTINCT ?item ?ioc WHERE {
  ?item p:P297 [] ; p:P984 ?statement .
  ?statement ps:P984 ?ioc ; wikibase:rank ?rank .
  FILTER(?rank != wikibase:DeprecatedRank)
  FILTER NOT EXISTS { ?statement pq:P582 [] }
} ORDER BY ?item ?ioc`,

  /**
   * English and multilingual (`mul`) labels and aliases of items holding an Alpha-2 code. Wikidata keeps a name that
   * reads the same in every language under `mul` only, not `en`. `DISTINCT`, as for `ioc`.
   */
  aliases: `SELECT DISTINCT ?item ?alias ?lang WHERE {
  ?item p:P297 [] .
  { ?item rdfs:label ?alias } UNION { ?item skos:altLabel ?alias }
  BIND(LANG(?alias) AS ?lang)
  FILTER(?lang IN ("en", "mul"))
} ORDER BY ?item ?alias ?lang`,

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

// Every shipped Code system has a query to read its codes from.
true satisfies CodeSystem extends WikidataSnapshot ? true : false;

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

/** The FIFA association properties that say which area it covers, most specific first. */
export const COVERAGE_PROPERTIES = ["P1001", "P2541", "P17"] as const;

/** The languages Aliases are read in, English first, so its spelling wins over a multilingual (`mul`) one. */
export const ALIAS_LANGUAGES = ["en", "mul"] as const;
export type AliasLanguage = (typeof ALIAS_LANGUAGES)[number];

/** The Wikidata Snapshots, validated and with item URIs shortened to ids such as `Q183`. */
export interface Wikidata {
  /** Items holding an Alpha-2 code, with whether that statement is deprecated or the item or statement has ended. */
  items: { item: string; alpha2: string; current: boolean }[];
  ioc: { item: string; ioc: string }[];
  /** Labels and aliases, with whether each is English (`en`) or multilingual (`mul`). */
  aliases: { item: string; alias: string; lang: AliasLanguage }[];
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
      z.object({ item: ItemIdSchema, alias: z.string(), lang: z.enum(ALIAS_LANGUAGES) }),
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

/** A Code system code, with the Source it came from. */
export interface SourcedCode {
  code: string;
  source: string;
}

/** What Wikidata gives the Entities built from CLDR and the Overlay. */
export interface WikidataJoin {
  /** Each Entity's Code system codes, Overlay code corrections applied. */
  codes: Map<string, Map<CodeSystem, SourcedCode>>;
  /** The labels of the item each Country and Territory is read from, for the Alias rules. */
  aliasCandidates: AliasCandidate[];
}

/**
 * Joins Wikidata's Code system codes and labels to the Entities built from CLDR and the Overlay (ADR-0001), adding
 * every problem it finds to `problems` rather than stopping at the first. The labels are only candidates: the Alias
 * rules decide which ship.
 */
export function joinWikidata({
  countries,
  subdivisions,
  overlay,
  wikidata,
  problems,
}: {
  countries: readonly Country[];
  subdivisions: readonly Subdivision[];
  overlay: Pick<Overlay, "wikidataItems" | "codes" | "fifaAssociations" | "territories">;
  wikidata: Wikidata;
  problems: string[];
}): WikidataJoin {
  const countryIds = new Set(countries.map(({ id }) => id));
  const subdivisionIds = new Set(subdivisions.map(({ id }) => id));
  const territoryIds = new Set(overlay.territories.map(({ id }) => id));

  const currentItems = new Map<string, string[]>();
  for (const { item, alpha2, current } of wikidata.items) {
    if (current && (countryIds.has(alpha2) || territoryIds.has(alpha2)))
      append(currentItems, alpha2, item);
  }
  const pinnedItems = new Map<string, string>();
  for (const { country, item } of overlay.wikidataItems) {
    if (!countryIds.has(country)) {
      problems.push(`Wikidata item for ${country} has a dangling Country`);
      continue;
    }
    if (pinnedItems.has(country)) problems.push(`Country ${country} has two Wikidata items`);
    else if (!wikidata.items.some((row) => row.item === item && row.alpha2 === country))
      problems.push(`Wikidata item ${item} for ${country} doesn't hold its Alpha-2 code`);
    else if (currentItems.get(country)?.length === 1 && currentItems.get(country)?.[0] === item)
      problems.push(
        `Wikidata item for ${country} is its only current item, so it is no longer needed`,
      );
    pinnedItems.set(country, item);
  }
  /** The item each Country's or Territory's Code system codes and Aliases are read from. */
  const countryItems = new Map<string, string>();
  for (const [country, items] of currentItems) {
    if (pinnedItems.has(country)) continue;
    if (items.length === 1) countryItems.set(country, items[0]!);
    else
      problems.push(
        `Alpha-2 code ${country} is on more than one current Wikidata item, ${items.join(", ")}; name one in the Overlay`,
      );
  }
  for (const [country, item] of pinnedItems) countryItems.set(country, item);
  const itemCountries = new Map([...countryItems].map(([country, item]) => [item, country]));
  /** The Country or Territory each current item denotes, for reading which area a FIFA association covers. */
  const areaCountries = new Map(itemCountries);
  for (const [country, items] of currentItems) {
    for (const item of items) areaCountries.set(item, country);
  }

  /** The Entities that can hold Code system codes: every Kind but Historic countries (ADR-0003). */
  const codeHolderIds = new Set([...countryIds, ...subdivisionIds, ...territoryIds]);

  // Overlay corrections replace whatever Wikidata gives an Entity in that Code system.
  const corrections = new Map<string, Map<CodeSystem, { code: string; replaced: Set<string> }>>();
  for (const { entity, system, code } of overlay.codes) {
    const name = CODE_SYSTEMS[system].name;
    if (!codeHolderIds.has(entity))
      problems.push(`${name} code correction has a dangling Entity ${entity}`);
    else if (corrections.get(entity)?.has(system))
      problems.push(`${entity} has two ${name} code corrections`);
    const entityCorrections = corrections.get(entity) ?? new Map();
    entityCorrections.set(system, { code, replaced: new Set() });
    corrections.set(entity, entityCorrections);
  }

  const codeSystems = new Map<string, Map<CodeSystem, SourcedCode>>();
  function addCode(id: string, system: CodeSystem, code: string, source: string): void {
    const correction = corrections.get(id)?.get(system);
    if (correction !== undefined && source !== "Overlay") {
      correction.replaced.add(code);
      return;
    }
    const codes = codeSystems.get(id) ?? new Map();
    const existing = codes.get(system);
    if (existing !== undefined && existing.code !== code)
      problems.push(
        `${id} has two ${CODE_SYSTEMS[system].name} codes, ${existing.code} and ${code}`,
      );
    codes.set(system, existing ?? { code, source });
    codeSystems.set(id, codes);
  }
  for (const { item, ioc } of wikidata.ioc) {
    const country = itemCountries.get(item);
    if (country !== undefined) addCode(country, "ioc", ioc, `Wikidata ${item}`);
  }

  // A FIFA code sits on the Entity whose territory its association covers, of any Kind (ADR-0012). An area item
  // denotes the Country holding its Alpha-2 code, else the Subdivision holding its Subdivision code.
  const fifaAssociations = new Map<
    string,
    { codes: Set<string>; covers: Map<string, Set<string>> }
  >();
  for (const { association, fifa, property, area, subdivision } of wikidata.fifa) {
    const entry = fifaAssociations.get(association) ?? { codes: new Set(), covers: new Map() };
    entry.codes.add(fifa);
    if (property !== undefined && area !== undefined) {
      const entity =
        areaCountries.get(area) ??
        (subdivision !== undefined && subdivisionIds.has(subdivision) ? subdivision : undefined);
      const covered = entry.covers.get(property) ?? new Set();
      if (entity !== undefined) covered.add(entity);
      entry.covers.set(property, covered);
    }
    fifaAssociations.set(association, entry);
  }
  const associationEntities = new Map<string, string | null>();
  for (const { association, entity } of overlay.fifaAssociations) {
    if (!fifaAssociations.has(association))
      problems.push(`FIFA association ${association} in the Overlay isn't in the Snapshot`);
    else if (entity !== null && !codeHolderIds.has(entity))
      problems.push(`FIFA association ${association} has a dangling Entity ${entity}`);
    associationEntities.set(association, entity);
  }
  for (const [association, { codes, covers }] of [...fifaAssociations].sort(([a], [b]) =>
    a < b ? -1 : 1,
  )) {
    let entity = associationEntities.get(association);
    if (entity === undefined) {
      const covered = COVERAGE_PROPERTIES.map((property) => covers.get(property)).find(
        (entities) => entities !== undefined && entities.size > 0,
      );
      const label = `FIFA association ${association} (${[...codes].join(", ")})`;
      if (covered === undefined || covered.size > 1) {
        problems.push(
          covered === undefined
            ? `${label} covers no Entity; name its Entity in the Overlay`
            : `${label} covers more than one Entity, ${[...covered].sort().join(" and ")}; name its Entity in the Overlay`,
        );
        continue;
      }
      entity = [...covered][0]!;
    }
    if (entity === null) continue;
    for (const code of codes) addCode(entity, "fifa", code, `Wikidata ${association}`);
  }

  for (const { entity, system, code } of overlay.codes) {
    const correction = corrections.get(entity)?.get(system);
    if (correction?.replaced.size === 1 && correction.replaced.has(code))
      problems.push(
        `${CODE_SYSTEMS[system].name} code correction for ${entity} matches Wikidata, so it is no longer needed`,
      );
    addCode(entity, system, code, "Overlay");
  }

  for (const system of CODE_SYSTEM_KEYS) {
    const holders = new Map<string, string[]>();
    for (const [id, codes] of codeSystems) {
      const code = codes.get(system)?.code;
      if (code !== undefined) append(holders, code, id);
    }
    for (const [code, ids] of holders) {
      if (ids.length > 1)
        problems.push(
          `${CODE_SYSTEMS[system].name} code ${code} is on more than one Entity, ${ids.sort().join(" and ")}`,
        );
    }
  }

  const aliasCandidates: AliasCandidate[] = [];
  for (const { item, alias, lang } of wikidata.aliases) {
    const id = itemCountries.get(item);
    if (id !== undefined)
      aliasCandidates.push({ id, alias, origin: { source: "Wikidata", item, lang } });
  }

  return { codes: codeSystems, aliasCandidates };
}
