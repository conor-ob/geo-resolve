import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { XMLParser } from "fast-xml-parser";
import type { Country, Subdivision } from "geo-resolve";
import { z } from "zod";

export interface BuildOptions {
  /** Directory holding the Snapshots written by `fetch`. */
  sourcesDir: string;
  /** Directory the Data packs are written to. */
  outDir: string;
}

const Alpha2Schema = z.string().regex(/^[A-Z]{2}$/, "must be an Alpha-2 code");

const CountrySchema = z.strictObject({
  kind: z.literal("country"),
  id: Alpha2Schema,
  alpha2: Alpha2Schema,
  alpha3: z.string().regex(/^[A-Z]{3}$/, "must be an Alpha-3 code"),
  numeric: z.string().regex(/^\d{3}$/, "must be a three-digit Numeric code"),
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

// The published Entity types are the source of truth; these fail typechecking if a schema drifts from them.
// No Source fills `codes` yet, so the schemas reject it until Code systems are built.
true satisfies Exactly<Readonly<z.infer<typeof CountrySchema>>, Omit<Country, "codes">>;
true satisfies Exactly<Readonly<z.infer<typeof SubdivisionSchema>>, Omit<Subdivision, "codes">>;

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
export async function build({ sourcesDir, outDir }: BuildOptions): Promise<void> {
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

  const seenIds = new Set<string>();
  for (const { id } of subdivisions) {
    if (seenIds.has(id) || countryIds.has(id)) problems.push(`Duplicate id ${id}`);
    seenIds.add(id);
  }

  if (problems.length > 0) throw new Error(`Invalid data:\n${problems.join("\n")}`);

  countries.sort(byId);
  subdivisions.sort(byId);
  await mkdir(join(outDir, "subdivisions"), { recursive: true });
  await writeJson(join(outDir, "countries.json"), countries);
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

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}
