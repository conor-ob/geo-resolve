import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Country, HistoricCountry, Subdivision } from "geo-resolve";
import { z } from "zod";

/**
 * The Debian `iso-codes` release the generated data is compared against. It is an oracle only (ADR-0001): it is
 * fetched at check time, never committed, and `build` never reads it. Upgrading it is a reviewed change.
 */
export const ISO_CODES_RELEASE = "v4.20.1";

const ISO_CODES_PARTS = ["3166-1", "3166-2", "3166-3"] as const;

/** The `iso-codes` data files, parsed but not yet validated, keyed by the part of ISO 3166 each covers. */
export type IsoCodes = Record<(typeof ISO_CODES_PARTS)[number], unknown>;

/** Identifies the project to upstream servers by its repository URL only, never a personal address. */
const USER_AGENT = "geo-resolve-codegen (+https://github.com/conor-ob/geo-resolve)";

/** Downloads the pinned `iso-codes` release's ISO 3166 files, keeping them in memory only. */
export async function fetchIsoCodes(): Promise<IsoCodes> {
  const files: Partial<IsoCodes> = {};
  for (const part of ISO_CODES_PARTS) {
    const url = `https://salsa.debian.org/iso-codes-team/iso-codes/-/raw/${ISO_CODES_RELEASE}/data/iso_${part}.json`;
    const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!response.ok)
      throw new Error(`GET ${url} failed: ${response.status} ${response.statusText}`);
    files[part] = await response.json();
  }
  return files as IsoCodes;
}

const IsoCountriesSchema = z.object({
  "3166-1": z.array(
    z.object({
      alpha_2: z.string(),
      alpha_3: z.string(),
      numeric: z.string(),
      name: z.string(),
      common_name: z.string().optional(),
      official_name: z.string().optional(),
    }),
  ),
});

const IsoSubdivisionsSchema = z.object({
  "3166-2": z.array(
    z.object({ code: z.string(), name: z.string(), parent: z.string().optional() }),
  ),
});

const IsoHistoricCountriesSchema = z.object({
  "3166-3": z.array(
    z.object({
      alpha_4: z.string(),
      alpha_2: z.string(),
      alpha_3: z.string().optional(),
      numeric: z.string().optional(),
      name: z.string(),
      withdrawal_date: z.string().optional(),
    }),
  ),
});

function parseIsoCodes<T>(part: string, value: unknown, schema: z.ZodType<T>): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new Error(`iso-codes ${part} is malformed:\n${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

const FieldSchema = z.enum([
  "presence",
  "name",
  "parent",
  "alpha2",
  "alpha3",
  "numeric",
  "withdrawn",
]);

type Field = z.infer<typeof FieldSchema>;

/**
 * Known differences between the generated data and `iso-codes`, grouped under the reason a reviewer accepted them.
 * Entries name Entity ids and fields only; no `iso-codes` values are written here.
 */
const AllowlistSchema = z.strictObject({
  differences: z.array(
    z.strictObject({
      field: FieldSchema,
      reason: z.string().min(1, "must say why the difference is accepted"),
      ids: z.array(z.string()).min(1, "must list at least one Entity id"),
    }),
  ),
});

export interface CompareOptions {
  /** Directory holding the generated Data packs. */
  dataDir: string;
  /** The `iso-codes` files to compare against, from `fetchIsoCodes`. */
  isoCodes: IsoCodes;
  /** The reviewed allowlist of known differences. */
  allowlistPath: string;
}

interface Difference {
  id: string;
  field: Field;
  ours: string | undefined;
  iso: string | undefined;
}

/**
 * Compares the generated Countries, Subdivisions and Historic countries with `iso-codes`, and fails on any
 * difference the allowlist doesn't list, and on any allowlist entry that no longer matches a difference.
 */
export async function compareWithIsoCodes({
  dataDir,
  isoCodes,
  allowlistPath,
}: CompareOptions): Promise<void> {
  const allowlist = AllowlistSchema.safeParse(JSON.parse(await readFile(allowlistPath, "utf8")));
  if (!allowlist.success)
    throw new Error(`Allowlist is malformed:\n${z.prettifyError(allowlist.error)}`);

  const differences = [
    ...compareCountries(
      await readJson<Country[]>(dataDir, "countries.json"),
      await readJson<Record<string, string[]>>(dataDir, "countries.aliases.json"),
      parseIsoCodes("3166-1", isoCodes["3166-1"], IsoCountriesSchema)["3166-1"],
    ),
    ...compareSubdivisions(
      await readSubdivisions(dataDir),
      parseIsoCodes("3166-2", isoCodes["3166-2"], IsoSubdivisionsSchema)["3166-2"],
    ),
    ...compareHistoricCountries(
      await readJson<HistoricCountry[]>(dataDir, "historic-countries.json"),
      await readJson<Record<string, string[]>>(dataDir, "historic-countries.aliases.json"),
      parseIsoCodes("3166-3", isoCodes["3166-3"], IsoHistoricCountriesSchema)["3166-3"],
    ),
  ];

  const allowed = new Map<string, string>();
  const problems: string[] = [];
  for (const { field, reason, ids } of allowlist.data.differences) {
    for (const id of ids) {
      const key = `${id} ${field}`;
      if (allowed.has(key)) problems.push(`Allowlist lists the ${field} of ${id} twice`);
      allowed.set(key, reason);
    }
  }

  for (const { id, field, ours, iso } of differences) {
    const key = `${id} ${field}`;
    if (allowed.delete(key)) continue;
    problems.push(
      field === "presence"
        ? `${id} is ${ours === undefined ? "missing from our data" : "not in iso-codes"}`
        : `${id} ${field} differs: ours ${format(ours)}, iso-codes ${format(iso)}`,
    );
  }
  for (const key of allowed.keys()) {
    const [id, field] = key.split(" ");
    problems.push(`Allowlist lists the ${field} of ${id}, which no longer differs`);
  }

  if (problems.length > 0)
    throw new Error(`Differences from iso-codes ${ISO_CODES_RELEASE}:\n${problems.join("\n")}`);
}

function format(value: string | undefined): string {
  return value === undefined ? "none" : JSON.stringify(value);
}

/** Pairs records by id, reporting ids found on only one side, and compares the pairs with `fields`. */
function comparePaired<O, I>(
  ours: Map<string, O>,
  iso: Map<string, I>,
  fields: (ours: O, iso: I) => [Field, string | undefined, string | undefined, boolean?][],
): Difference[] {
  const differences: Difference[] = [];
  for (const id of new Set([...ours.keys(), ...iso.keys()])) {
    const o = ours.get(id);
    const i = iso.get(id);
    if (o === undefined || i === undefined) {
      differences.push({
        id,
        field: "presence",
        ours: o === undefined ? undefined : id,
        iso: i === undefined ? undefined : id,
      });
      continue;
    }
    for (const [field, ourValue, isoValue, agree = ourValue === isoValue] of fields(o, i)) {
      if (!agree) differences.push({ id, field, ours: ourValue, iso: isoValue });
    }
  }
  return differences.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** A Name agrees when our Name or one of our Aliases is one of the names ISO gives. */
function namesAgree(
  ours: string,
  aliases: readonly string[] = [],
  iso: readonly unknown[],
): boolean {
  return [ours, ...aliases].some((name) => iso.includes(name));
}

function compareCountries(
  ours: readonly Country[],
  aliases: Record<string, string[]>,
  iso: z.infer<typeof IsoCountriesSchema>["3166-1"],
): Difference[] {
  return comparePaired(
    new Map(ours.map((country) => [country.id, country])),
    new Map(iso.map((country) => [country.alpha_2, country])),
    (o, i) => [
      ["alpha3", o.alpha3, i.alpha_3],
      ["numeric", o.numeric, i.numeric],
      [
        "name",
        o.name,
        i.common_name ?? i.name,
        namesAgree(o.name, aliases[o.id], [i.name, i.common_name, i.official_name]),
      ],
    ],
  );
}

function compareSubdivisions(
  ours: readonly Subdivision[],
  iso: z.infer<typeof IsoSubdivisionsSchema>["3166-2"],
): Difference[] {
  return comparePaired(
    new Map(ours.map((subdivision) => [subdivision.id, subdivision])),
    new Map(iso.map((subdivision) => [subdivision.code, subdivision])),
    // iso-codes leaves out the Parent of a Subdivision directly under its Country.
    (o, i) => [
      ["parent", o.parent, i.parent ?? i.code.slice(0, 2)],
      ["name", o.name, i.name],
    ],
  );
}

function compareHistoricCountries(
  ours: readonly HistoricCountry[],
  aliases: Record<string, string[]>,
  iso: z.infer<typeof IsoHistoricCountriesSchema>["3166-3"],
): Difference[] {
  return comparePaired(
    new Map(ours.map((country) => [country.id, country])),
    new Map(iso.map((country) => [country.alpha_4, country])),
    (o, i) => [
      ["alpha2", o.alpha2, i.alpha_2],
      ["alpha3", o.alpha3, i.alpha_3],
      ["numeric", o.numeric, i.numeric],
      ["name", o.name, i.name, namesAgree(o.name, aliases[o.id], [i.name])],
      // A date of year or month precision agrees with the more precise date it is a prefix of.
      [
        "withdrawn",
        o.withdrawn,
        i.withdrawal_date,
        i.withdrawal_date !== undefined &&
          (i.withdrawal_date === o.withdrawn || i.withdrawal_date.startsWith(`${o.withdrawn}-`)),
      ],
    ],
  );
}

async function readJson<T>(dataDir: string, file: string): Promise<T> {
  return JSON.parse(await readFile(join(dataDir, file), "utf8")) as T;
}

async function readSubdivisions(dataDir: string): Promise<Subdivision[]> {
  const files = (await readdir(join(dataDir, "subdivisions"))).filter((file) =>
    file.endsWith(".json"),
  );
  const packs = await Promise.all(
    files.map((file) => readJson<Subdivision[]>(dataDir, join("subdivisions", file))),
  );
  return packs.flat();
}
