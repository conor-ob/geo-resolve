import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Country, HistoricCountry, Subdivision } from "geo-resolve";
import { z } from "zod";
import type { Overlay } from "./build.ts";
import { CODE_SYSTEM_KEYS, CODE_SYSTEMS, type CodeSystem } from "./code-systems.ts";
import { append } from "./lists.ts";

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

/** The languages Aliases are read in, English first, so its spelling wins over a multilingual (`mul`) one. */
export const ALIAS_LANGUAGES = ["en", "mul"] as const;

/** The Wikidata Snapshots, validated and with item URIs shortened to ids such as `Q183`. */
export interface Wikidata {
  /** Items holding an Alpha-2 code, with whether that statement is deprecated or the item or statement has ended. */
  items: { item: string; alpha2: string; current: boolean }[];
  ioc: { item: string; ioc: string }[];
  /** Labels and aliases, with whether each is English (`en`) or multilingual (`mul`). */
  aliases: { item: string; alias: string; lang: (typeof ALIAS_LANGUAGES)[number] }[];
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

/** An Alias, with the Source it came from, for the build report. */
export interface AliasSource {
  id: string;
  alias: string;
  source: string;
}

/** A Wikidata or CLDR Alias that isn't an Alias of its Entity, because a rule or the Overlay drops it, with why, for the build report. */
export interface DroppedAlias {
  id: string;
  alias: string;
  reason: string;
}

/** What Wikidata gives the Entities built from CLDR and the Overlay, with the Aliases that pass the Alias rules. */
export interface WikidataJoin {
  /** Each Entity's Code system codes, Overlay code corrections applied. */
  codes: Map<string, Map<CodeSystem, SourcedCode>>;
  /** The Aliases of each Country and Territory, from Wikidata, CLDR and the Overlay. */
  aliases: AliasSource[];
  /** The Aliases the Alias rules or the Overlay dropped. */
  droppedAliases: DroppedAlias[];
}

/** Must match the package's own normalisation, so the build compares Aliases and codes as `resolve` will. */
export function matchKey(input: string): string {
  return input.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim().replace(/\s+/g, " ");
}

/** Whether an Alias reads as a name: letters with spaces and punctuation, not a flag, time zone or calling code. */
function isName(alias: string): boolean {
  return /^[\p{L}\p{M} .,'’‘&()\-–]+$/u.test(alias);
}

/** Whether every letter of an Alias is Latin script, as a multilingual (`mul`) one must be to read as English. */
function isLatin(alias: string): boolean {
  return /^[\p{Script=Latin}\P{L}]*$/u.test(alias);
}

/** Keys an Overlay removal by Entity and match key, so it matches the Alias whatever its case or accents. */
function removalKey(entity: string, alias: string): string {
  return `${entity}\t${matchKey(alias)}`;
}

/** How many capital letters an Alias has, to choose between Aliases that differ only in case. */
function countCapitals(alias: string): number {
  return alias.match(/\p{Lu}/gu)?.length ?? 0;
}

/**
 * Joins Wikidata's Code system codes and Aliases to the Entities built from CLDR and the Overlay (ADR-0001), and
 * applies the Alias rules to Wikidata's Aliases and CLDR's variant and short English names alike, adding every problem it
 * finds to `problems` rather than stopping at the first.
 */
export function joinWikidata({
  countries,
  subdivisions,
  historicCountries,
  overlay,
  wikidata,
  cldrAliases,
  problems,
}: {
  countries: readonly Country[];
  subdivisions: readonly Subdivision[];
  historicCountries: readonly HistoricCountry[];
  overlay: Overlay;
  wikidata: Wikidata;
  /** CLDR's variant and short English names (ADR-0014), keyed by Entity `id`. */
  cldrAliases: ReadonlyMap<string, readonly string[]>;
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

  // Aliases are names only: one that is a code would shadow the code's own Entity, and one that names a
  // Historic country would map it to a current Country, which geo-resolve never does (ADR-0003).
  const codeHolders = new Map<string, string[]>();
  const holdsCode = (code: string, id: string) => append(codeHolders, matchKey(code), id);
  for (const { id, alpha2, alpha3, numeric } of countries)
    for (const code of [alpha2, alpha3, numeric]) holdsCode(code, id);
  for (const { id, code } of subdivisions) holdsCode(code, id);
  for (const { id, alpha4, alpha2, alpha3, numeric } of historicCountries) {
    for (const code of [alpha4, alpha2, alpha3, numeric])
      if (code !== undefined) holdsCode(code, id);
  }
  for (const id of territoryIds) holdsCode(id, id);
  for (const [id, codes] of codeSystems) for (const { code } of codes.values()) holdsCode(code, id);
  const historicNames = new Map<string, string>();
  for (const { id, name } of historicCountries)
    historicNames.set(matchKey(name), `the Name of the Historic country ${id}`);
  for (const { alpha4, aliases } of overlay.historicCountries) {
    for (const alias of aliases)
      historicNames.set(matchKey(alias), `an Alias of the Historic country ${alpha4}`);
  }
  const entityNames = new Map(
    [...countries, ...overlay.territories].map(({ id, name }) => [id, name]),
  );
  // An Alias that is a different Entity's Name, or another Entity's Alias, would make a common Input an Ambiguous
  // input, which the default English Resolver never has (ADR-0013), unless a Same-as link joins the two Entities.
  const nameHolders = new Map<string, string[]>();
  for (const { id, name } of [...countries, ...overlay.territories, ...subdivisions])
    append(nameHolders, matchKey(name), id);
  const sameAs = new Map<string, string[]>();
  for (const {
    entities: [country, subdivision],
  } of overlay.sameAs) {
    append(sameAs, country, subdivision);
    append(sameAs, subdivision, country);
  }
  const unlinked = (id: string, others: readonly string[]) =>
    others.filter((other) => other !== id && !sameAs.get(id)?.includes(other));
  // Overlay removals take an Alias from the Sources before the shared-Alias check below, so removing a shared Alias
  // from all but one Entity gives it back to that one (ADR-0013).
  // Each one must match an Alias from the Sources that no rule drops, so a stale removal is noticed when upstream
  // fixes the label.
  const historicCountryIds = new Set(historicCountries.map(({ id }) => id));
  /** Why an Overlay Alias entry's Entity can't hold Aliases from the Sources, or `undefined` when it can. */
  const notAliasHolder = (label: string, entity: string) =>
    historicCountryIds.has(entity)
      ? `${label} is for the Historic country ${entity}; edit the Aliases listed on it instead`
      : !entityNames.has(entity)
        ? `${label} has a dangling Entity ${entity}`
        : undefined;
  const removals = new Map<
    string,
    { entity: string; alias: string; reason: string; matched: boolean }
  >();
  for (const { entity, alias, reason } of overlay.removedAliases) {
    const label = `Overlay removal of ${alias}`;
    const problem = notAliasHolder(label, entity);
    const key = removalKey(entity, alias);
    if (problem !== undefined) problems.push(problem);
    else if (removals.has(key)) problems.push(`${label} from ${entity} is listed twice`);
    else removals.set(key, { entity, alias, reason, matched: false });
  }
  // Overlay additions give a Country or Territory an Alias the Sources lack, such as one Wikidata dropped. They must
  // pass the same rules, so the Overlay can't make an Input ambiguous either.
  const additions = new Map<string, string[]>();
  for (const { entity, alias } of overlay.addedAliases) {
    const label = `Overlay Alias ${alias}`;
    const problem = notAliasHolder(label, entity);
    if (problem !== undefined) problems.push(problem);
    else if (additions.get(entity)?.some((other) => matchKey(other) === matchKey(alias)))
      problems.push(`${label} for ${entity} is listed twice`);
    else append(additions, entity, alias);
  }
  const aliases: AliasSource[] = [];
  const droppedAliases: DroppedAlias[] = [];
  for (const country of [...entityNames.keys()].sort()) {
    const item = countryItems.get(country);
    const keys = new Set([matchKey(entityNames.get(country)!)]);
    // CLDR's Names win over Wikidata rows with the same match key, as CLDR curates them, so the report attributes
    // them to CLDR. Among Wikidata rows, the language ALIAS_LANGUAGES ranks first wins, so an English spelling ships
    // over a multilingual one that differs in accents.
    const rank = (lang: (typeof ALIAS_LANGUAGES)[number]) => ALIAS_LANGUAGES.indexOf(lang);
    const cldrRows = (cldrAliases.get(country) ?? []).map((alias) => ({
      alias,
      lang: "en" as const,
      source: "CLDR",
    }));
    const itemAliases = wikidata.aliases
      .filter((row) => item !== undefined && row.item === item)
      .sort((a, b) => rank(a.lang) - rank(b.lang) || (a.alias < b.alias ? -1 : 1))
      .map((row) => ({ ...row, source: `Wikidata ${item}` }));
    const overlayRows = (additions.get(country) ?? []).map((alias) => ({
      alias,
      lang: "en" as const,
      source: "Overlay",
    }));
    /** The match keys of the Overlay's additions, which a Source giving the same Alias makes stale. */
    const added = new Map(overlayRows.map(({ alias }) => [matchKey(alias), alias]));
    for (const row of [...overlayRows, ...cldrRows, ...itemAliases]) {
      const key = matchKey(row.alias);
      if (keys.has(key)) {
        if (row.source === "Overlay")
          problems.push(`Overlay Alias ${row.alias} for ${country} is its Name`);
        else if (added.has(key)) {
          problems.push(
            `Overlay Alias ${added.get(key)} for ${country} is also from ${row.source}, so it is no longer needed`,
          );
          added.delete(key);
        }
        continue;
      }
      keys.add(key);
      // Rows that differ only in case, in any language, ship the one with the most capitals, ties going to the
      // order above, so the casing that ships doesn't depend on which variants upstream happens to keep. Case only,
      // not the whole match key, so an English spelling still wins on accents. The row that took the match key still
      // decides the script rule by its language, as casing never changes a script. A CLDR name ships as CLDR writes it.
      const { alias } =
        row.source === "CLDR" || row.source === "Overlay"
          ? row
          : itemAliases
              .filter((other) => other.alias.toLowerCase() === row.alias.toLowerCase())
              .reduce((best, other) =>
                countCapitals(other.alias) > countCapitals(best.alias) ? other : best,
              );
      const { lang, source } = row;
      const holders = codeHolders.get(key);
      const named = unlinked(country, nameHolders.get(key) ?? []);
      const reason = !isName(alias)
        ? "not a name"
        : lang === "mul" && !isLatin(alias)
          ? "not in Latin script"
          : holders !== undefined
            ? `a code of ${[...new Set(holders)].sort().join(" and ")}`
            : (historicNames.get(key) ??
              (named.length > 0 ? `the Name of ${named.sort().join(" and ")}` : undefined));
      const removal = removals.get(removalKey(country, row.alias));
      if (removal !== undefined) removal.matched = true;
      if (source === "Overlay") {
        // A reviewer added it, so breaking a rule fails the build rather than quietly dropping it.
        if (removal !== undefined)
          problems.push(`Overlay Alias ${alias} for ${country} is also removed by the Overlay`);
        else if (reason !== undefined)
          problems.push(`Overlay Alias ${alias} for ${country} is ${reason}`);
        else aliases.push({ id: country, alias, source });
      } else if (reason !== undefined) {
        if (removal !== undefined)
          problems.push(
            `Overlay removal of ${removal.alias} from ${country} matches an Alias already dropped as ${reason}, so it is no longer needed`,
          );
        droppedAliases.push({ id: country, alias, reason });
      } else if (removal !== undefined)
        droppedAliases.push({
          id: country,
          alias,
          reason: `removed by the Overlay: ${removal.reason}`,
        });
      else aliases.push({ id: country, alias, source });
    }
  }

  for (const { entity, alias, matched } of removals.values()) {
    if (!matched)
      problems.push(
        `Overlay removal of ${alias} from ${entity} matches no Alias from the Sources, so it is no longer needed`,
      );
  }

  const aliasHolders = new Map<string, string[]>();
  for (const { id, alias } of aliases) append(aliasHolders, matchKey(alias), id);
  const unshared = aliases.filter(({ id, alias, source }) => {
    const shared = unlinked(id, aliasHolders.get(matchKey(alias))!);
    if (shared.length === 0) return true;
    if (source === "Overlay")
      problems.push(
        `Overlay Alias ${alias} for ${id} is also an Alias of ${shared.sort().join(" and ")}`,
      );
    else
      droppedAliases.push({ id, alias, reason: `also an Alias of ${shared.sort().join(" and ")}` });
    return false;
  });

  return { codes: codeSystems, aliases: unshared, droppedAliases };
}
