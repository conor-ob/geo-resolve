import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { XMLParser } from "fast-xml-parser";
import type { Country, HistoricCountry, Subdivision } from "geo-resolve";
import { z } from "zod";

export interface BuildOptions {
  /** Directory holding the Snapshots written by `fetch`. */
  sourcesDir: string;
  /** The hand-maintained Overlay file, applied on top of the Snapshots. */
  overlayPath: string;
  /** Directory the Data packs are written to. */
  outDir: string;
}

const Alpha2Schema = z.string().regex(/^[A-Z]{2}$/, "must be an Alpha-2 code");
const Alpha3Schema = z.string().regex(/^[A-Z]{3}$/, "must be an Alpha-3 code");
const NumericSchema = z.string().regex(/^\d{3}$/, "must be a three-digit Numeric code");

const CountrySchema = z.strictObject({
  kind: z.literal("country"),
  id: Alpha2Schema,
  alpha2: Alpha2Schema,
  alpha3: Alpha3Schema,
  numeric: NumericSchema,
  name: z.string().min(1, "must not be empty"),
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
});

/** True for a real date written as `YYYY`, `YYYY-MM` or `YYYY-MM-DD`, so `2006-13-45` is rejected. */
function isIso8601Date(value: string): boolean {
  if (!/^\d{4}(-\d{2}(-\d{2})?)?$/.test(value)) return false;
  const [year, month = "01", day = "01"] = value.split("-");
  const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(`${year}-${month}-${day}`);
}

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
// No Source fills `codes` yet, so the schemas reject it until Code systems are built.
true satisfies Exactly<Readonly<z.infer<typeof CountrySchema>>, Omit<Country, "codes">>;
true satisfies Exactly<Readonly<z.infer<typeof SubdivisionSchema>>, Omit<Subdivision, "codes">>;
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

const OverlaySchema = z.strictObject({
  historicCountries: z.array(OverlayHistoricCountrySchema).default([]),
  formerCodes: z.array(OverlayFormerCodeSchema).default([]),
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
export async function build({ sourcesDir, overlayPath, outDir }: BuildOptions): Promise<void> {
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

  // Containment also lists codes CLDR has deprecated in favour of a CLDR region (`uspr` for PR); only regular codes are Subdivisions.
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
  const subdivisionNames = new Map(
    englishSubdivisions.ldml.localeDisplayNames.subdivisions.subdivision.map((row) => [
      subdivisionCode(row.type),
      row["#text"],
    ]),
  );
  const subdivisionIds = subdivisionValidity.supplementalData.idValidity.id
    .filter((row) => row.type === "subdivision" && row.idStatus === "regular")
    .flatMap((row) => expandCodes(row["#text"]))
    .map(subdivisionCode);
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

  // The Overlay is applied last, so it can refer to any Entity built from the Snapshots.
  const overlay = await readOverlay(overlayPath);
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

  // Former codes of Countries that still exist are Aliases, not Historic countries (ADR-0003).
  const countryAliases = new Map<string, string[]>();
  for (const { country, code } of overlay.formerCodes) {
    if (!countryIds.has(country))
      problems.push(`Former code ${code} has a dangling Country ${country}`);
    countryAliases.set(country, [...(countryAliases.get(country) ?? []), code]);
  }

  if (problems.length > 0) throw new Error(`Invalid data:\n${problems.join("\n")}`);

  countries.sort(byId);
  historicCountries.sort(byId);
  subdivisions.sort(byId);
  await mkdir(join(outDir, "subdivisions"), { recursive: true });
  await writeJson(join(outDir, "countries.json"), countries);
  await writeJson(join(outDir, "countries.aliases.json"), sortedAliases(countryAliases));
  await writeJson(join(outDir, "historic-countries.json"), historicCountries);
  await writeJson(
    join(outDir, "historic-countries.aliases.json"),
    sortedAliases(historicCountryAliases),
  );
  for (const { id } of countries) {
    const pack = subdivisions.filter((subdivision) => subdivision.country === id);
    await writeJson(join(outDir, "subdivisions", `${id}.json`), pack);
    await writeFile(join(outDir, "subdivisions", `${id}.ts`), countrySubdivisionsModule(id));
  }
  await writeFile(join(outDir, "subdivisions.ts"), allSubdivisionsModule(countries));
}

const GENERATED = "// Generated by `@geo-resolve/codegen build` from the Snapshots. Do not edit.";

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
