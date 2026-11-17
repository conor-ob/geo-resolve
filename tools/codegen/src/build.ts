import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { XMLParser } from "fast-xml-parser";
import type { Country, HistoricCountry, Subdivision, Territory } from "geo-resolve";
import { z } from "zod";
import { CODE_SYSTEM_KEYS, codeSystemNames } from "./code-systems.ts";
import { append } from "./lists.ts";
import { linkSameAs, readOverlay } from "./overlay.ts";
import { buildReport, GENERATED, type FormerCodeScheme, type FormerCodeSource } from "./report.ts";
import {
  CountrySchema,
  HistoricCountrySchema,
  SubdivisionSchema,
  TerritorySchema,
} from "./schemas.ts";
import { applyAliasRules, type AliasCandidate, type AliasSource } from "./alias-rules.ts";
import { joinWikidata, matchKey, readWikidata } from "./wikidata.ts";

export interface BuildOptions {
  /** Directory holding the Snapshots written by `fetch`. */
  sourcesDir: string;
  /** The hand-maintained Overlay file, applied on top of the Snapshots. */
  overlayPath: string;
  /** Directory the Data packs are written to. */
  outDir: string;
  /** Where to write the build report, which isn't shipped. Omitted, none is written. */
  reportPath?: string;
}

/** A CLDR validity file, which lists codes of one type (regions, Subdivisions) by status. */
const IdValiditySchema = z.object({
  supplementalData: z.object({
    idValidity: z.object({
      id: z.array(
        z.object({ type: z.string(), idStatus: z.string(), "#text": z.string().default("") }),
      ),
    }),
  }),
});

const CodeMappingsSchema = z.object({
  supplementalData: z.object({
    codeMappings: z.object({
      territoryCodes: z.array(
        z.object({
          type: z.string(),
          alpha3: z.string().optional(),
          numeric: z.string().optional(),
        }),
      ),
    }),
  }),
});

const EnglishNamesSchema = z.object({
  ldml: z.object({
    localeDisplayNames: z.object({
      territories: z.object({
        territory: z.array(
          z.object({ type: z.string(), alt: z.string().optional(), "#text": z.string() }),
        ),
      }),
    }),
  }),
});

/** The `alt` forms of CLDR's English region names that are Aliases of their Entity (ADR-0014). */
const CLDR_ALIAS_ALTS: readonly string[] = ["variant", "short"];

/**
 * ISO 3166-1 codes that CLDR lists as regular regions but that ISO doesn't assign to a Country:
 * the exceptionally reserved codes (AC, CP, CQ, DG, EA, IC, TA) and the user-assigned ranges
 * (AA, QM–QZ, XA–XZ, ZZ), which permissive Sources use for Territories such as XK.
 */
function isAssignedByIso(code: string): boolean {
  if (["AC", "CP", "CQ", "DG", "EA", "IC", "TA", "AA", "ZZ"].includes(code)) return false;
  return !/^(Q[M-Z]|X[A-Z])$/.test(code);
}

/** An element with no children parses as `""`; this reads it as an element with none. */
function element<T extends z.ZodType>(schema: T) {
  return z.preprocess((value) => (value === "" ? {} : value), schema);
}

const SubdivisionContainmentSchema = z.object({
  supplementalData: z.object({
    subdivisionContainment: element(
      z.object({
        subgroup: z.array(z.object({ type: z.string(), contains: z.string() })).default([]),
      }),
    ),
  }),
});

const EnglishSubdivisionNamesSchema = z.object({
  ldml: z.object({
    localeDisplayNames: z.object({
      subdivisions: element(
        z.object({
          subdivision: z.array(z.object({ type: z.string(), "#text": z.string() })).default([]),
        }),
      ),
    }),
  }),
});

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseTagValue: false,
  isArray: (name) =>
    ["id", "territoryCodes", "territory", "subgroup", "subdivision"].includes(name),
});

async function readSnapshot<T>(sourcesDir: string, path: string, schema: z.ZodType<T>): Promise<T> {
  const parsed = schema.safeParse(xml.parse(await readFile(join(sourcesDir, path), "utf8")));
  if (!parsed.success)
    throw new Error(`Snapshot ${path} is malformed:\n${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

/** Expands a CLDR validity list such as `AC~G AI` into `AC AD AE AF AG AI`. */
function expandCodes(list: string): string[] {
  return list
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((item) => {
      const [start, end] = item.split("~");
      if (start === undefined || end === undefined) return [item];
      const prefix = start.slice(0, -1);
      const codes: string[] = [];
      for (let c = start.charCodeAt(start.length - 1); c <= end.charCodeAt(0); c++) {
        codes.push(prefix + String.fromCharCode(c));
      }
      return codes;
    });
}

/** Turns a CLDR Subdivision code such as `usca` into its Subdivision code, `US-CA`. */
function subdivisionCode(cldrCode: string): string {
  return `${cldrCode.slice(0, 2)}-${cldrCode.slice(2)}`.toUpperCase();
}

/** Turns a CLDR containment `type` into its Parent's Entity `id`: Countries are written as Alpha-2 codes, Subdivisions in lowercase. */
function parentId(type: string): string {
  return /^[A-Z]{2}$/.test(type) ? type : subdivisionCode(type);
}

function byId(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Reads the Snapshots in `sourcesDir`, validates every record and writes sorted Data packs to `outDir`. */
export async function build({
  sourcesDir,
  overlayPath,
  outDir,
  reportPath,
}: BuildOptions): Promise<void> {
  const validity = await readSnapshot(
    sourcesDir,
    "cldr/common/validity/region.xml",
    IdValiditySchema,
  );
  const mappings = await readSnapshot(
    sourcesDir,
    "cldr/common/supplemental/supplementalData.xml",
    CodeMappingsSchema,
  );
  const english = await readSnapshot(sourcesDir, "cldr/common/main/en.xml", EnglishNamesSchema);
  const subdivisionValidity = await readSnapshot(
    sourcesDir,
    "cldr/common/validity/subdivision.xml",
    IdValiditySchema,
  );
  const containment = await readSnapshot(
    sourcesDir,
    "cldr/common/supplemental/subdivisions.xml",
    SubdivisionContainmentSchema,
  );
  const englishSubdivisions = await readSnapshot(
    sourcesDir,
    "cldr/common/subdivisions/en.xml",
    EnglishSubdivisionNamesSchema,
  );

  const codes = new Map(
    mappings.supplementalData.codeMappings.territoryCodes.map((row) => [row.type, row]),
  );
  const names = new Map(
    english.ldml.localeDisplayNames.territories.territory
      .filter((row) => row.alt === undefined)
      .map((row) => [row.type, row["#text"]]),
  );
  const cldrAliases = new Map<string, string[]>();
  for (const row of english.ldml.localeDisplayNames.territories.territory) {
    if (row.alt !== undefined && CLDR_ALIAS_ALTS.includes(row.alt))
      append(cldrAliases, row.type, row["#text"]);
  }

  const regularCodes = validity.supplementalData.idValidity.id
    .filter((row) => row.type === "region" && row.idStatus === "regular")
    .flatMap((row) => expandCodes(row["#text"]));

  const problems: string[] = [];
  const countries: Country[] = [];
  for (const alpha2 of regularCodes.filter(isAssignedByIso)) {
    const record = {
      kind: "country",
      id: alpha2,
      alpha2,
      alpha3: codes.get(alpha2)?.alpha3,
      numeric: codes.get(alpha2)?.numeric,
      name: names.get(alpha2),
    };
    const parsed = CountrySchema.safeParse(record);
    if (parsed.success) countries.push(parsed.data);
    else problems.push(`Country ${alpha2}:\n${z.prettifyError(parsed.error)}`);
  }

  for (const field of ["id", "alpha3", "numeric"] as const) {
    const seen = new Set<string>();
    for (const country of countries) {
      if (seen.has(country[field])) problems.push(`Duplicate ${field} ${country[field]}`);
      seen.add(country[field]);
    }
  }

  // CLDR deprecates some codes ISO still lists, because the place has its own region code (`uspr` for PR), but keeps
  // them in containment; codes ISO withdrew drop out of it. So a deprecated code that containment lists is a Subdivision.
  const parents = new Map<string, string>();
  for (const { type, contains } of containment.supplementalData.subdivisionContainment.subgroup) {
    for (const child of contains.split(/\s+/).filter(Boolean)) {
      const id = subdivisionCode(child);
      const parent = parentId(type);
      const existing = parents.get(id);
      if (existing !== undefined && existing !== parent)
        problems.push(`Subdivision ${id} has two Parents, ${existing} and ${parent}`);
      parents.set(id, parent);
    }
  }

  const overlay = await readOverlay(overlayPath);

  // Parent corrections replace CLDR's Parent before the hierarchy is checked, so a corrected Parent must resolve too.
  const corrected = new Set<string>();
  for (const { subdivision, parent } of overlay.parents) {
    if (corrected.has(subdivision))
      problems.push(`Subdivision ${subdivision} has two Parent corrections`);
    else if (!parents.has(subdivision))
      problems.push(`Parent correction for ${subdivision} has a dangling Subdivision`);
    else if (parents.get(subdivision) === parent)
      problems.push(`Parent correction for ${subdivision} matches CLDR, so it is no longer needed`);
    corrected.add(subdivision);
    parents.set(subdivision, parent);
  }

  const subdivisionNames = new Map(
    englishSubdivisions.ldml.localeDisplayNames.subdivisions.subdivision.map((row) => [
      subdivisionCode(row.type),
      row["#text"],
    ]),
  );
  const subdivisionIdsWithStatus = (status: string) =>
    subdivisionValidity.supplementalData.idValidity.id
      .filter((row) => row.type === "subdivision" && row.idStatus === status)
      .flatMap((row) => expandCodes(row["#text"]))
      .map(subdivisionCode);
  const subdivisionIds = [
    ...subdivisionIdsWithStatus("regular"),
    ...subdivisionIdsWithStatus("deprecated").filter((id) => parents.has(id)),
  ];
  const countryIds = new Set(countries.map((country) => country.id));
  const knownSubdivisionIds = new Set(subdivisionIds);

  /** Follows Parents up to the Country at the top, or returns `undefined` when the chain breaks or loops. */
  function countryOf(id: string): string | undefined {
    const seen = new Set<string>();
    for (let current = parents.get(id); current !== undefined; current = parents.get(current)) {
      if (countryIds.has(current)) return current;
      if (!knownSubdivisionIds.has(current)) {
        problems.push(`Subdivision ${id} has a dangling Parent ${current}`);
        return undefined;
      }
      if (seen.has(current)) {
        problems.push(`Subdivision ${id} has Parents that form a cycle`);
        return undefined;
      }
      seen.add(current);
    }
    problems.push(`Subdivision ${id} has no Parent`);
    return undefined;
  }

  const subdivisions: Subdivision[] = [];
  for (const id of subdivisionIds) {
    const country = countryOf(id);
    if (country === undefined) continue;
    if (!id.startsWith(`${country}-`)) {
      problems.push(`Subdivision ${id} doesn't start with its Country's Alpha-2 code ${country}`);
      continue;
    }
    const record = {
      kind: "subdivision",
      id,
      code: id,
      country,
      parent: parents.get(id),
      name: subdivisionNames.get(id),
    };
    const parsed = SubdivisionSchema.safeParse(record);
    if (parsed.success) subdivisions.push(parsed.data);
    else problems.push(`Subdivision ${id}:\n${z.prettifyError(parsed.error)}`);
  }

  const subdivisionIdsSeen = new Set<string>();
  for (const { id } of subdivisions) {
    if (subdivisionIdsSeen.has(id) || countryIds.has(id)) problems.push(`Duplicate id ${id}`);
    subdivisionIdsSeen.add(id);
  }

  // The rest of the Overlay is applied last, so it can refer to any Entity built from the Snapshots.
  // Same-as links join a Country and a Subdivision, and are written on both sides so neither can be one-sided.
  const sameAs = linkSameAs(overlay, { countryIds, subdivisionIds: subdivisionIdsSeen }, problems);
  function withSameAs<T extends Country | Subdivision>(entity: T): T {
    const links = sameAs.get(entity.id);
    return links === undefined ? entity : { ...entity, sameAs: links };
  }

  const historicCountries: HistoricCountry[] = overlay.historicCountries.map(
    ({ aliases: _aliases, citation: _citation, ...record }) =>
      HistoricCountrySchema.parse({
        kind: "historic-country",
        id: record.alpha4,
        ...record,
        successors: [...record.successors].sort(),
      }),
  );
  const historicCountryAliases = new Map(
    overlay.historicCountries.map(({ alpha4, aliases }) => [alpha4, aliases]),
  );
  // Ids are unique across Kinds (ADR-0003); Countries and Subdivisions were checked above.
  const entityIds = new Set([...countryIds, ...subdivisionIdsSeen]);
  for (const { id } of historicCountries) {
    if (entityIds.has(id)) problems.push(`Duplicate id ${id}`);
    entityIds.add(id);
  }
  for (const { id, successors } of historicCountries) {
    for (const [i, successor] of successors.entries()) {
      if (successor === id) problems.push(`Historic country ${id} is its own Successor`);
      else if (!entityIds.has(successor))
        problems.push(`Historic country ${id} has a dangling Successor ${successor}`);
      // Successors are sorted, so a repeat sits next to its first occurrence.
      if (successors[i - 1] === successor)
        problems.push(`Historic country ${id} lists Successor ${successor} twice`);
    }
  }

  // A Territory has no ISO Country entry but is a CLDR region of its own (ADR-0012). Its user-assigned id can't be a
  // Country's, so a Country with its Name is how ISO would list it. Subdivisions may share its ground or Name: ISO
  // lists Kosovo as the Serbian Subdivision RS-KM, with a district RS-25 named Kosovo.
  const regularRegions = new Set(regularCodes);
  const countryIdsByName = new Map(countries.map(({ id, name }) => [matchKey(name), id]));
  const territoryIds = new Set<string>();
  for (const { id, name } of overlay.territories) {
    if (entityIds.has(id)) problems.push(`Duplicate id ${id}`);
    if (!regularRegions.has(id))
      problems.push(`Territory ${id} isn't a CLDR region, so it has no localised Names`);
    const listed = countryIdsByName.get(matchKey(name));
    if (listed !== undefined)
      problems.push(
        `Territory ${id} ${name} is listed by ISO as the Country ${listed}, so it isn't a Territory`,
      );
    entityIds.add(id);
    territoryIds.add(id);
  }

  // Former codes of Countries that still exist count under the Scheme that issued them, not as Aliases or Historic
  // countries (ADR-0003). The code's shape says which: the schema admits only Alpha-2, Alpha-3 and Numeric codes.
  const countryFormerCodes = new Map<string, Map<FormerCodeScheme, string[]>>();
  /** Every former code with its Scheme, for the build report. */
  const formerCodeSources: FormerCodeSource[] = [];
  for (const { country, code } of overlay.formerCodes) {
    if (!countryIds.has(country))
      problems.push(`Former code ${code} has a dangling Country ${country}`);
    const scheme = formerCodeScheme(code);
    const schemes = countryFormerCodes.get(country) ?? new Map<FormerCodeScheme, string[]>();
    append(schemes, scheme, code);
    countryFormerCodes.set(country, schemes);
    formerCodeSources.push({ id: country, scheme, code });
  }
  const countryAliases = new Map<string, string[]>();
  /** Every Alias with the Source it came from, for the build report. */
  const aliasSources: AliasSource[] = [];
  for (const [id, aliases] of historicCountryAliases) {
    for (const alias of aliases) aliasSources.push({ id, alias, source: "Overlay" });
  }

  // Wikidata supplies Code system codes and Alias candidates only, joined to the Entities built above (ADR-0001).
  const { codes: codeSystems, aliasCandidates } = joinWikidata({
    countries,
    subdivisions,
    overlay,
    wikidata: await readWikidata(sourcesDir),
    problems,
  });
  /** The Code system codes joined to an Entity, or `undefined` when it has none. */
  function codesOf(id: string): Record<string, string> | undefined {
    const codes = codeSystems.get(id);
    return codes && Object.fromEntries([...codes].map(([system, { code }]) => [system, code]));
  }
  function withCodes<T extends Country | Subdivision>(entity: T): T {
    const codes = codesOf(entity.id);
    if (codes === undefined) return entity;
    const record = { ...entity, codes };
    const parsed = (entity.kind === "country" ? CountrySchema : SubdivisionSchema).safeParse(
      record,
    );
    if (!parsed.success) problems.push(`${entity.id}:\n${z.prettifyError(parsed.error)}`);
    return record;
  }
  const countriesWithCodes = countries.map(withCodes);

  // At least two shipped Code systems must code a Territory as a peer of Countries (ADR-0012), and they must be the
  // ones the Overlay admits it for, so a Code system dropping it is noticed.
  const territories: Territory[] = [];
  for (const { id, name, codeSystems: admittedFor } of overlay.territories) {
    const coded = CODE_SYSTEM_KEYS.filter((system) => codeSystems.get(id)?.has(system));
    if (coded.length < 2)
      problems.push(
        `Territory ${id} is coded by ${codeSystemNames(coded)}, but needs at least two shipped Code systems to be admitted`,
      );
    else if (
      coded.length !== new Set(admittedFor).size ||
      coded.some((system) => !admittedFor.includes(system))
    )
      problems.push(
        `Territory ${id} is admitted for its ${codeSystemNames(admittedFor)} codes, but is coded by ${codeSystemNames(coded)}`,
      );
    const parsed = TerritorySchema.safeParse({
      kind: "territory",
      id,
      name,
      codes: codesOf(id) ?? {},
    });
    if (parsed.success) territories.push(parsed.data);
    else problems.push(`Territory ${id}:\n${z.prettifyError(parsed.error)}`);
  }

  const subdivisionsWithCodes = subdivisions.map(withCodes);

  // CLDR's variant and short English names are Alias candidates too, under the same rules as Wikidata's (ADR-0014).
  const { aliases: joinedAliases, dropped: droppedAliases } = applyAliasRules({
    entities: {
      countries: countriesWithCodes,
      territories,
      subdivisions: subdivisionsWithCodes,
      historicCountries,
      historicAliases: historicCountryAliases,
      sameAs,
    },
    candidates: [
      ...[...cldrAliases].flatMap(([id, aliases]) =>
        aliases.map((alias): AliasCandidate => ({ id, alias, origin: { source: "CLDR" } })),
      ),
      ...aliasCandidates,
    ],
    overlay,
    problems,
  });
  const territoryAliases = new Map<string, string[]>();
  for (const source of joinedAliases) {
    append(
      territoryIds.has(source.id) ? territoryAliases : countryAliases,
      source.id,
      source.alias,
    );
    aliasSources.push(source);
  }

  if (problems.length > 0) throw new Error(`Invalid data:\n${problems.join("\n")}`);

  countriesWithCodes.sort(byId);
  historicCountries.sort(byId);
  subdivisionsWithCodes.sort(byId);
  territories.sort(byId);
  await mkdir(join(outDir, "subdivisions"), { recursive: true });
  await writeJson(join(outDir, "countries.json"), countriesWithCodes.map(withSameAs));
  await writeJson(join(outDir, "countries.aliases.json"), sortedAliases(countryAliases));
  await writeJson(
    join(outDir, "countries.former-codes.json"),
    sortedFormerCodes(countryFormerCodes),
  );
  await writeJson(join(outDir, "historic-countries.json"), historicCountries);
  await writeJson(
    join(outDir, "historic-countries.aliases.json"),
    sortedAliases(historicCountryAliases),
  );
  await writeJson(join(outDir, "territories.json"), territories);
  await writeJson(join(outDir, "territories.aliases.json"), sortedAliases(territoryAliases));
  for (const { id } of countries) {
    const pack = subdivisionsWithCodes
      .filter((subdivision) => subdivision.country === id)
      .map(withSameAs);
    await writeJson(join(outDir, "subdivisions", `${id}.json`), pack);
    await writeFile(join(outDir, "subdivisions", `${id}.ts`), countrySubdivisionsModule(id));
  }
  await writeFile(join(outDir, "subdivisions.ts"), allSubdivisionsModule(countries));
  await writeFile(join(outDir, "known-codes.ts"), knownCodesModule(countries, subdivisions));
  if (reportPath !== undefined)
    await writeFile(
      reportPath,
      buildReport({
        countries: countriesWithCodes,
        subdivisions,
        historicCountries,
        territories,
        aliasSources,
        formerCodes: formerCodeSources,
        droppedAliases,
        codeSystems,
      }),
    );
}

/** The `geo-resolve/data/subdivisions/<country>` Data pack. */
function countrySubdivisionsModule(country: string): string {
  return `${GENERATED}
import { dataPack } from "../../data-pack.ts";
import type { Subdivision } from "../../types.ts";
import subdivisions from "./${country}.json" with { type: "json" };

/** The Subdivisions of the Country ${country}, sorted by \`id\`. */
export default dataPack(subdivisions as readonly Subdivision[]);
`;
}

/**
 * The `geo-resolve/data/subdivisions` Data pack, built from the per-Country packs so that loading
 * both shares the same Entities rather than duplicating them.
 */
function allSubdivisionsModule(countries: readonly Country[]): string {
  const imports = countries.map(({ id }) => `import ${id} from "./subdivisions/${id}.ts";`);
  const spreads = countries.map(({ id }) => `  ...${id},`);
  return `${GENERATED}
import { dataPack } from "../data-pack.ts";
${imports.join("\n")}

/** Every Subdivision, sorted by \`id\`. */
export default dataPack([
${spreads.join("\n")}
]);
`;
}

/** The `Known…` literal unions, exported as optional helpers that semver doesn't cover (ADR-0006). */
function knownCodesModule(
  countries: readonly Country[],
  subdivisions: readonly Subdivision[],
): string {
  const unions = [
    knownUnion(
      "KnownAlpha2",
      "Alpha-2 code of every Country",
      countries.map((c) => c.alpha2),
    ),
    knownUnion(
      "KnownAlpha3",
      "Alpha-3 code of every Country",
      countries.map((c) => c.alpha3),
    ),
    knownUnion(
      "KnownSubdivisionCode",
      "Subdivision code of every Subdivision",
      subdivisions.map((s) => s.code),
    ),
  ];
  return `${GENERATED}\n\n${unions.join("\n\n")}\n`;
}

/** A sorted literal union, one member per line so a data release diffs code by code. */
function knownUnion(name: string, description: string, codes: readonly string[]): string {
  const members = [...new Set(codes)].sort().map((code) => `  | ${JSON.stringify(code)}`);
  return `/**
 * The ${description} in this release.
 * Not covered by semver: a data release may add or withdraw codes (ADR-0006).
 * @beta
 */
export type ${name} =\n${members.join("\n")};`;
}

/** The Scheme a former code is in, read from its shape: two letters, three letters or three digits. */
function formerCodeScheme(code: string): FormerCodeScheme {
  return /^\d{3}$/.test(code) ? "numeric" : code.length === 2 ? "alpha2" : "alpha3";
}

/** Former codes by Country `id`, then by Scheme, each sorted, for stable generated output. */
function sortedFormerCodes(
  formerCodes: Map<string, Map<FormerCodeScheme, string[]>>,
): Record<string, Partial<Record<FormerCodeScheme, string[]>>> {
  return Object.fromEntries(
    [...formerCodes]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([id, schemes]) => [
        id,
        Object.fromEntries(
          [...schemes]
            .sort(([a], [b]) => (a < b ? -1 : 1))
            .map(([scheme, codes]) => [scheme, [...codes].sort()]),
        ),
      ]),
  );
}

/** Aliases keyed by Entity `id`, with ids and each Entity's Aliases sorted so the output is deterministic. */
function sortedAliases(aliases: Map<string, string[]>): Record<string, string[]> {
  return Object.fromEntries(
    [...aliases]
      .filter(([, names]) => names.length > 0)
      .sort(([a], [b]) => byId({ id: a }, { id: b }))
      .map(([id, names]) => [id, [...new Set(names)].sort()]),
  );
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}
