import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { XMLParser } from "fast-xml-parser";
import type { Country, HistoricCountry, Subdivision, Territory } from "geo-resolve";
import { z } from "zod";
import { COVERAGE_PROPERTIES, ItemIdSchema, readWikidata } from "./wikidata.ts";

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

const Alpha2Schema = z.string().regex(/^[A-Z]{2}$/, "must be an Alpha-2 code");
const Alpha3Schema = z.string().regex(/^[A-Z]{3}$/, "must be an Alpha-3 code");
const NumericSchema = z.string().regex(/^\d{3}$/, "must be a three-digit Numeric code");

/** A code in a non-ISO Code system, such as the IOC's `GER`. */
const CodeSystemCodeSchema = z.string().regex(/^[A-Z]{3}$/, "must be three capital letters");

/** An Entity's codes in non-ISO Code systems, named for their Code system (ADR-0003). */
const CodesSchema = z.strictObject({
  ioc: CodeSystemCodeSchema.optional(),
  fifa: CodeSystemCodeSchema.optional(),
});

/** The `id`s of the Entities an Entity is joined to by Same-as links. */
const SameAsSchema = z.array(z.string()).readonly().optional();

const CountrySchema = z.strictObject({
  kind: z.literal("country"),
  id: Alpha2Schema,
  alpha2: Alpha2Schema,
  alpha3: Alpha3Schema,
  numeric: NumericSchema,
  name: z.string().min(1, "must not be empty"),
  codes: CodesSchema.optional(),
  sameAs: SameAsSchema,
});

/** True only when `A` and `B` are identical, including which fields are optional. */
type Exactly<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

const SubdivisionCodeSchema = z
  .string()
  .regex(/^[A-Z]{2}-[A-Z0-9]{1,3}$/, "must be a Subdivision code");

const SubdivisionSchema = z.strictObject({
  kind: z.literal("subdivision"),
  id: SubdivisionCodeSchema,
  code: SubdivisionCodeSchema,
  country: Alpha2Schema,
  parent: z.union([Alpha2Schema, SubdivisionCodeSchema]),
  name: z.string().min(1, "must not be empty"),
  codes: CodesSchema.optional(),
  sameAs: SameAsSchema,
});

/** True for a real date written as `YYYY`, `YYYY-MM` or `YYYY-MM-DD`, so `2006-13-45` is rejected. */
function isIso8601Date(value: string): boolean {
  if (!/^\d{4}(-\d{2}(-\d{2})?)?$/.test(value)) return false;
  const [year, month = "01", day = "01"] = value.split("-");
  const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(`${year}-${month}-${day}`);
}

/** A user-assigned ISO 3166-1 code, which ISO never assigns itself, so it can't collide with a Country (ADR-0012). */
const UserAssignedCodeSchema = z.string().regex(/^X[A-Z]$/, "must be a user-assigned code, XA–XZ");

const TerritorySchema = z.strictObject({
  kind: z.literal("territory"),
  id: UserAssignedCodeSchema,
  name: z.string().min(1, "must not be empty"),
  codes: CodesSchema,
  sameAs: SameAsSchema,
});

const Alpha4Schema = z.string().regex(/^[A-Z]{4}$/, "must be an Alpha-4 code");

const HistoricCountrySchema = z.strictObject({
  kind: z.literal("historic-country"),
  id: Alpha4Schema,
  alpha4: Alpha4Schema,
  alpha2: Alpha2Schema,
  alpha3: Alpha3Schema.optional(),
  numeric: NumericSchema.optional(),
  name: z.string().min(1, "must not be empty"),
  withdrawn: z
    .string()
    .refine(isIso8601Date, "must be an ISO 8601 date of year, month or day precision"),
  successors: z.array(z.string()).min(1, "must name at least one Successor").readonly(),
});

// The published Entity types are the source of truth; these fail typechecking if a schema drifts from them.
// `Codes` is an open union of Code systems (the same on every Kind), so the schema, which names only the shipped
// ones, need only fit it.
true satisfies Exactly<
  Readonly<Omit<z.infer<typeof CountrySchema>, "codes">>,
  Omit<Country, "codes">
>;
true satisfies Exactly<
  Readonly<Omit<z.infer<typeof SubdivisionSchema>, "codes">>,
  Omit<Subdivision, "codes">
>;
true satisfies Exactly<
  Readonly<Omit<z.infer<typeof TerritorySchema>, "codes">>,
  Omit<Territory, "codes">
>;
true satisfies z.infer<typeof CodesSchema> extends Country["codes"] & Territory["codes"]
  ? true
  : false;
true satisfies Exactly<Readonly<z.infer<typeof HistoricCountrySchema>>, HistoricCountry>;

/** The ISO page (a URL) or change notice (such as `ISO 3166-1 Newsletter V-3`) a curated record came from, so a reviewer can verify it. */
const CitationSchema = z.string().min(1, "must cite the ISO page or change notice");

/** A Historic country as curated in the Overlay: its Entity fields, any Aliases, and a citation. */
const OverlayHistoricCountrySchema = z.strictObject({
  ...HistoricCountrySchema.omit({ kind: true, id: true }).shape,
  aliases: z.array(z.string().min(1, "must not be empty")).default([]),
  citation: CitationSchema,
});

/** A code ISO once assigned to a Country that still exists, such as `ROM` for Romania (now `ROU`). */
const OverlayFormerCodeSchema = z.strictObject({
  country: Alpha2Schema,
  code: z.string().regex(/^([A-Z]{2,3}|\d{3})$/, "must be an Alpha-2, Alpha-3 or Numeric code"),
  citation: CitationSchema,
});

/** A Country and a Subdivision ISO lists separately that denote the same territory, such as `PR` and `US-PR`. */
const OverlaySameAsSchema = z.strictObject({
  entities: z.tuple([Alpha2Schema, SubdivisionCodeSchema]),
  citation: CitationSchema,
});

/** The Parent ISO gives a Subdivision where CLDR lags, such as FR-67, which ISO moved from Grand Est to Alsace. */
const OverlayParentSchema = z.strictObject({
  subdivision: SubdivisionCodeSchema,
  parent: z.union([Alpha2Schema, SubdivisionCodeSchema]),
  citation: CitationSchema,
});

/** Why an Overlay entry corrects a Source, so a reviewer can check it without re-deriving it. */
const ReasonSchema = z.string().min(1, "must give a reason");

/**
 * The Wikidata item a Country's Code system codes and Aliases are read from, where its Alpha-2 code is on more than
 * one current item (AQ, CY) or on an item other than the one holding the rest (NL is on Q29999, the Kingdom of the
 * Netherlands, but Q55, the Netherlands, holds its other codes).
 */
const OverlayWikidataItemSchema = z.strictObject({
  country: Alpha2Schema,
  item: ItemIdSchema,
  reason: ReasonSchema,
});

const EntityIdSchema = z.union([Alpha2Schema, SubdivisionCodeSchema]);

/** A code the Overlay gives an Entity in a Code system, replacing any Wikidata gives it, such as FIFA's NIR for GB-NIR. */
const OverlayCodeSchema = z.strictObject({
  entity: EntityIdSchema,
  system: z.enum(["ioc", "fifa"]),
  code: CodeSystemCodeSchema,
  reason: ReasonSchema,
});

/**
 * The Entity whose territory a FIFA association covers, where Wikidata's jurisdiction, operating area and country
 * name several Entities or none (ADR-0012), or `null` to omit the association, such as one that isn't a FIFA member.
 */
const OverlayFifaAssociationSchema = z.strictObject({
  association: ItemIdSchema,
  entity: EntityIdSchema.nullable(),
  reason: ReasonSchema,
});

/**
 * A Territory admitted under ADR-0012: its `id` and English Name, and the Code systems that code it as a peer of
 * Countries, which `build` checks against the codes it joins.
 */
const OverlayTerritorySchema = z.strictObject({
  id: UserAssignedCodeSchema,
  name: z.string().min(1, "must not be empty"),
  codeSystems: z.array(z.enum(["ioc", "fifa"])),
  reason: ReasonSchema,
});

const OverlaySchema = z.strictObject({
  historicCountries: z.array(OverlayHistoricCountrySchema).default([]),
  formerCodes: z.array(OverlayFormerCodeSchema).default([]),
  sameAs: z.array(OverlaySameAsSchema).default([]),
  parents: z.array(OverlayParentSchema).default([]),
  wikidataItems: z.array(OverlayWikidataItemSchema).default([]),
  codes: z.array(OverlayCodeSchema).default([]),
  fifaAssociations: z.array(OverlayFifaAssociationSchema).default([]),
  territories: z.array(OverlayTerritorySchema).default([]),
});

type Overlay = z.infer<typeof OverlaySchema>;

async function readOverlay(path: string): Promise<Overlay> {
  const parsed = OverlaySchema.safeParse(JSON.parse(await readFile(path, "utf8")));
  if (!parsed.success) throw new Error(`Overlay is malformed:\n${z.prettifyError(parsed.error)}`);
  return parsed.data;
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
  const sameAs = new Map<string, string[]>();
  for (const { entities } of overlay.sameAs) {
    const [country, subdivision] = entities;
    const dangling = [
      ...(countryIds.has(country) ? [] : [country]),
      ...(subdivisionIdsSeen.has(subdivision) ? [] : [subdivision]),
    ];
    if (dangling.length > 0) {
      problems.push(
        `Same-as link ${country} ↔ ${subdivision} has a dangling Entity ${dangling.join(", ")}`,
      );
      continue;
    }
    if (sameAs.get(country)?.includes(subdivision)) {
      problems.push(`Same-as link ${country} ↔ ${subdivision} is listed twice`);
      continue;
    }
    sameAs.set(country, [...(sameAs.get(country) ?? []), subdivision]);
    sameAs.set(subdivision, [...(sameAs.get(subdivision) ?? []), country]);
  }
  function withSameAs<T extends Country | Subdivision>(entity: T): T {
    const links = sameAs.get(entity.id);
    return links === undefined ? entity : { ...entity, sameAs: [...links].sort() };
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

  // Former codes of Countries that still exist are Aliases, not Historic countries (ADR-0003).
  const countryAliases = new Map<string, string[]>();
  /** Every Alias with the Source it came from, for the build report. */
  const aliasSources: { id: string; alias: string; source: string }[] = [];
  for (const { country, code } of overlay.formerCodes) {
    if (!countryIds.has(country))
      problems.push(`Former code ${code} has a dangling Country ${country}`);
    countryAliases.set(country, [...(countryAliases.get(country) ?? []), code]);
    aliasSources.push({ id: country, alias: code, source: "Overlay" });
  }
  for (const [id, aliases] of historicCountryAliases) {
    for (const alias of aliases) aliasSources.push({ id, alias, source: "Overlay" });
  }

  // Wikidata supplies Code system codes and Aliases only, joined to the Entities built above (ADR-0001).
  const wikidata = await readWikidata(sourcesDir);
  const currentItems = new Map<string, string[]>();
  for (const { item, alpha2, current } of wikidata.items) {
    if (current && (countryIds.has(alpha2) || territoryIds.has(alpha2)))
      currentItems.set(alpha2, [...(currentItems.get(alpha2) ?? []), item]);
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
  const codeHolderIds = new Set([...countryIds, ...subdivisionIdsSeen, ...territoryIds]);

  // Overlay corrections replace whatever Wikidata gives an Entity in that Code system.
  const corrections = new Map<string, { code: string; replaced: Set<string> }>();
  for (const { entity, system, code } of overlay.codes) {
    const name = CODE_SYSTEM_NAMES[system];
    if (!codeHolderIds.has(entity))
      problems.push(`${name} code correction has a dangling Entity ${entity}`);
    else if (corrections.has(`${entity} ${system}`))
      problems.push(`${entity} has two ${name} code corrections`);
    corrections.set(`${entity} ${system}`, { code, replaced: new Set() });
  }

  /** Each Entity's Code system codes, with the Source each came from. */
  const codeSystems = new Map<string, Map<CodeSystem, { code: string; source: string }>>();
  function addCode(id: string, system: CodeSystem, code: string, source: string): void {
    const correction = corrections.get(`${id} ${system}`);
    if (correction !== undefined && source !== "Overlay") {
      correction.replaced.add(code);
      return;
    }
    const codes = codeSystems.get(id) ?? new Map();
    const existing = codes.get(system);
    if (existing !== undefined && existing.code !== code)
      problems.push(
        `${id} has two ${CODE_SYSTEM_NAMES[system]} codes, ${existing.code} and ${code}`,
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
        (subdivision !== undefined && subdivisionIdsSeen.has(subdivision)
          ? subdivision
          : undefined);
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
    const correction = corrections.get(`${entity} ${system}`);
    if (correction?.replaced.size === 1 && correction.replaced.has(code))
      problems.push(
        `${CODE_SYSTEM_NAMES[system]} code correction for ${entity} matches Wikidata, so it is no longer needed`,
      );
    addCode(entity, system, code, "Overlay");
  }

  for (const system of CODE_SYSTEMS) {
    const holders = new Map<string, string[]>();
    for (const [id, codes] of codeSystems) {
      const code = codes.get(system)?.code;
      if (code !== undefined) holders.set(code, [...(holders.get(code) ?? []), id]);
    }
    for (const [code, ids] of holders) {
      if (ids.length > 1)
        problems.push(
          `${CODE_SYSTEM_NAMES[system]} code ${code} is on more than one Entity, ${ids.sort().join(" and ")}`,
        );
    }
  }
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
    const coded = CODE_SYSTEMS.filter((system) => codeSystems.get(id)?.has(system));
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

  // Wikidata Aliases are names only: one that is a code would shadow the code's own Entity, and one that names a
  // Historic country would map it to a current Country, which geo-resolve never does (ADR-0003).
  const codeHolders = new Map<string, string[]>();
  function holdsCode(code: string, id: string): void {
    const key = matchKey(code);
    codeHolders.set(key, [...(codeHolders.get(key) ?? []), id]);
  }
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
  for (const [id, aliases] of historicCountryAliases) {
    for (const alias of aliases)
      historicNames.set(matchKey(alias), `an Alias of the Historic country ${id}`);
  }
  const entityNames = new Map(
    [...countries, ...overlay.territories].map(({ id, name }) => [id, name]),
  );
  const territoryAliases = new Map<string, string[]>();
  const droppedAliases: { id: string; alias: string; reason: string }[] = [];
  for (const [country, item] of [...countryItems].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const keys = new Set([matchKey(entityNames.get(country)!)]);
    const aliases = wikidata.aliases
      .filter((row) => row.item === item)
      .map(({ alias }) => alias)
      .sort();
    for (const alias of aliases) {
      const key = matchKey(alias);
      if (keys.has(key)) continue;
      keys.add(key);
      const holders = codeHolders.get(key);
      const reason = !isName(alias)
        ? "not a name"
        : holders === undefined
          ? historicNames.get(key)
          : `a code of ${[...new Set(holders)].sort().join(" and ")}`;
      if (reason !== undefined) {
        droppedAliases.push({ id: country, alias, reason });
        continue;
      }
      const target = territoryIds.has(country) ? territoryAliases : countryAliases;
      target.set(country, [...(target.get(country) ?? []), alias]);
      aliasSources.push({ id: country, alias, source: `Wikidata ${item}` });
    }
  }
  const subdivisionsWithCodes = subdivisions.map(withCodes);

  if (problems.length > 0) throw new Error(`Invalid data:\n${problems.join("\n")}`);

  countriesWithCodes.sort(byId);
  historicCountries.sort(byId);
  subdivisionsWithCodes.sort(byId);
  territories.sort(byId);
  await mkdir(join(outDir, "subdivisions"), { recursive: true });
  await writeJson(join(outDir, "countries.json"), countriesWithCodes.map(withSameAs));
  await writeJson(join(outDir, "countries.aliases.json"), sortedAliases(countryAliases));
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
        droppedAliases,
        codeSystems,
      }),
    );
}

/** The Code systems geo-resolve builds, in the order the build report lists them. */
const CODE_SYSTEMS = ["ioc", "fifa"] as const;
type CodeSystem = (typeof CODE_SYSTEMS)[number];

const CODE_SYSTEM_NAMES: Record<CodeSystem, string> = { ioc: "IOC", fifa: "FIFA" };
/** Code systems named for a build problem, such as `IOC and FIFA`. */
function codeSystemNames(systems: readonly CodeSystem[]): string {
  return systems.map((system) => CODE_SYSTEM_NAMES[system]).join(" and ") || "no Code system";
}

const CODE_SYSTEM_ARTICLES: Record<CodeSystem, string> = { ioc: "an", fifa: "a" };

const GENERATED = "// Generated by `@geo-resolve/codegen build` from the Snapshots. Do not edit.";

/** Must match the package's own normalisation, so the build compares Aliases and codes as `resolve` will. */
function matchKey(input: string): string {
  return input.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim().replace(/\s+/g, " ");
}

/** Whether an Alias reads as a name: letters with spaces and punctuation, not a flag, time zone or calling code. */
function isName(alias: string): boolean {
  return /^[\p{L}\p{M} .,'’‘&()\-–]+$/u.test(alias);
}

/** A Markdown table, with `|` escaped in cells. */
function table(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const line = (cells: readonly string[]) =>
    `| ${cells.map((cell) => cell.replaceAll("|", "\\|")).join(" | ")} |`;
  return [line(header), line(header.map(() => "---")), ...rows.map(line)].join("\n");
}

function byCells(a: readonly string[], b: readonly string[]): number {
  for (const [i, cell] of a.entries()) {
    const other = b[i]!;
    if (cell !== other) return cell < other ? -1 : 1;
  }
  return 0;
}

/** A Markdown report of where the data came from, committed beside the Snapshots so a data change diffs in review. */
function buildReport({
  countries,
  subdivisions,
  historicCountries,
  territories,
  aliasSources,
  droppedAliases,
  codeSystems,
}: {
  countries: readonly Country[];
  subdivisions: readonly Subdivision[];
  historicCountries: readonly HistoricCountry[];
  territories: readonly Territory[];
  aliasSources: readonly { id: string; alias: string; source: string }[];
  droppedAliases: readonly { id: string; alias: string; reason: string }[];
  codeSystems: ReadonlyMap<string, ReadonlyMap<CodeSystem, { code: string; source: string }>>;
}): string {
  const sections = [
    `# Build report\n\n${GENERATED.replace("// ", "")}`,
    `## Names\n\nEvery Entity has one English Name, from the Source given for its Kind.\n\n${table(
      ["Kind", "Source", "Names"],
      [
        ["Country", "CLDR", String(countries.length)],
        ["Subdivision", "CLDR", String(subdivisions.length)],
        ["Historic country", "Overlay", String(historicCountries.length)],
        ["Territory", "Overlay", String(territories.length)],
      ],
    )}`,
    `## Aliases\n\n${table(
      ["Entity", "Alias", "Source"],
      aliasSources.map(({ id, alias, source }) => [id, alias, source]).sort(byCells),
    )}`,
    `## Wikidata Aliases dropped\n\nA Wikidata Alias that is a code, or names a Historic country, is not an Alias.\n\n${table(
      ["Entity", "Alias", "Dropped as"],
      droppedAliases.map(({ id, alias, reason }) => [id, alias, reason]).sort(byCells),
    )}`,
    `## Code system codes\n\n${table(
      ["Entity", "Code system", "Code", "Source"],
      [...codeSystems]
        .flatMap(([id, codes]) =>
          CODE_SYSTEMS.flatMap((system) => {
            const entry = codes.get(system);
            return entry === undefined
              ? []
              : [[id, CODE_SYSTEM_NAMES[system], entry.code, entry.source]];
          }),
        )
        .sort(byCells),
    )}`,
  ];
  for (const system of CODE_SYSTEMS) {
    const without = countries.filter(({ id }) => !codeSystems.get(id)?.has(system));
    sections.push(
      `## ${CODE_SYSTEM_NAMES[system]} coverage\n\n` +
        `${countries.length - without.length} of ${countries.length} Countries have ${CODE_SYSTEM_ARTICLES[system]} ${CODE_SYSTEM_NAMES[system]} code. ` +
        `The ${without.length} without one:\n\n` +
        without.map(({ id, name }) => `- ${id} ${name}`).join("\n"),
    );
  }
  return `${sections.join("\n\n")}\n`;
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
