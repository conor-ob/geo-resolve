import type {
  Country,
  HistoricCountry,
  KnownCodeSystem,
  Subdivision,
  Territory,
} from "geo-resolve";
import { z } from "zod";
import { CodeSystemCodeSchema, CodeSystemSchema, type CodeSystem } from "./code-systems.ts";

// The schemas every generated Entity is validated against, checked at compile time against the published types.

/** A Wikidata item id, such as `Q183`. */
export const ItemIdSchema = z.string().regex(/^Q\d+$/, "must be a Wikidata item id");

export const Alpha2Schema = z.string().regex(/^[A-Z]{2}$/, "must be an Alpha-2 code");
export const Alpha3Schema = z.string().regex(/^[A-Z]{3}$/, "must be an Alpha-3 code");
export const NumericSchema = z.string().regex(/^\d{3}$/, "must be a three-digit Numeric code");

/** An Entity's codes in non-ISO Code systems, named for their Code system (ADR-0003). */
const CodesSchema = z.partialRecord(CodeSystemSchema, CodeSystemCodeSchema);

/** The `id`s of the Entities an Entity is joined to by Same-as links. */
const SameAsSchema = z.array(z.string()).readonly().optional();

export const CountrySchema = z.strictObject({
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

export const SubdivisionCodeSchema = z
  .string()
  .regex(/^[A-Z]{2}-[A-Z0-9]{1,3}$/, "must be a Subdivision code");

export const SubdivisionSchema = z.strictObject({
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
export const UserAssignedCodeSchema = z
  .string()
  .regex(/^X[A-Z]$/, "must be a user-assigned code, XA–XZ");

export const TerritorySchema = z.strictObject({
  kind: z.literal("territory"),
  id: UserAssignedCodeSchema,
  name: z.string().min(1, "must not be empty"),
  codes: CodesSchema,
  sameAs: SameAsSchema,
});

export const Alpha4Schema = z.string().regex(/^[A-Z]{4}$/, "must be an Alpha-4 code");

export const HistoricCountrySchema = z.strictObject({
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
// ones, need only fit it. Those are exactly `KnownCodeSystem`.
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
true satisfies Exactly<CodeSystem, KnownCodeSystem>;
