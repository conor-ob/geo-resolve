import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { XMLParser } from "fast-xml-parser";
import { z } from "zod";

export interface BuildOptions {
  /** Directory holding the Snapshots written by `fetch`. */
  sourcesDir: string;
  /** Directory the Data packs are written to. */
  outDir: string;
}

const Country = z.strictObject({
  kind: z.literal("country"),
  id: z.string().regex(/^[A-Z]{2}$/, "must be an Alpha-2 code"),
  alpha2: z.string().regex(/^[A-Z]{2}$/, "must be an Alpha-2 code"),
  alpha3: z.string().regex(/^[A-Z]{3}$/, "must be an Alpha-3 code"),
  numeric: z.string().regex(/^\d{3}$/, "must be a three-digit Numeric code"),
  name: z.string().min(1, "must not be empty"),
});

type Country = z.infer<typeof Country>;

const RegionValidity = z.object({
  supplementalData: z.object({
    idValidity: z.object({
      id: z.array(
        z.object({ type: z.string(), idStatus: z.string(), "#text": z.string().default("") }),
      ),
    }),
  }),
});

const CodeMappings = z.object({
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

const EnglishNames = z.object({
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

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseTagValue: false,
  isArray: (name) => ["id", "territoryCodes", "territory"].includes(name),
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

/** Reads the Snapshots in `sourcesDir`, validates every record and writes sorted Data packs to `outDir`. */
export async function build({ sourcesDir, outDir }: BuildOptions): Promise<void> {
  const validity = await readSnapshot(
    sourcesDir,
    "cldr/common/validity/region.xml",
    RegionValidity,
  );
  const mappings = await readSnapshot(
    sourcesDir,
    "cldr/common/supplemental/supplementalData.xml",
    CodeMappings,
  );
  const english = await readSnapshot(sourcesDir, "cldr/common/main/en.xml", EnglishNames);

  const codes = new Map(
    mappings.supplementalData.codeMappings.territoryCodes.map((row) => [row.type, row]),
  );
  const names = new Map(
    english.ldml.localeDisplayNames.territories.territory
      .filter((row) => row.alt === undefined)
      .map((row) => [row.type, row["#text"]]),
  );

  const regions = validity.supplementalData.idValidity.id
    .filter((row) => row.type === "region" && row.idStatus === "regular")
    .flatMap((row) => expandCodes(row["#text"]));

  const problems: string[] = [];
  const countries: Country[] = [];
  for (const alpha2 of regions.filter(isAssignedByIso)) {
    const record = {
      kind: "country",
      id: alpha2,
      alpha2,
      alpha3: codes.get(alpha2)?.alpha3,
      numeric: codes.get(alpha2)?.numeric,
      name: names.get(alpha2),
    };
    const parsed = Country.safeParse(record);
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

  if (problems.length > 0) throw new Error(`Invalid data:\n${problems.join("\n")}`);

  countries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, "countries.json"), `${JSON.stringify(countries, null, 2)}\n`);
}
