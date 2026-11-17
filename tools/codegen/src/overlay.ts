import { readFile } from "node:fs/promises";
import { z } from "zod";
import { CodeSystemCodeSchema, CodeSystemSchema } from "./code-systems.ts";
import { append } from "./lists.ts";
import {
  Alpha2Schema,
  Alpha4Schema,
  HistoricCountrySchema,
  ItemIdSchema,
  SubdivisionCodeSchema,
  UserAssignedCodeSchema,
} from "./schemas.ts";

// The hand-maintained Overlay: additions and corrections applied on top of the Sources. Every entry must still apply
// to what the Sources give, so a stale one fails the build.

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
  system: CodeSystemSchema,
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
  codeSystems: z.array(CodeSystemSchema),
  reason: ReasonSchema,
});

/**
 * An Alias the Overlay adds to or removes from the Country or Territory whose `id` is `entity`. Alpha-4 codes are admitted only
 * so an entry for a Historic country, whose Aliases are listed on it, fails with a clear message.
 */
const OverlayAliasSchema = z.strictObject({
  entity: z.union([Alpha2Schema, Alpha4Schema]),
  alias: z.string().min(1, "must not be empty"),
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
  addedAliases: z.array(OverlayAliasSchema).default([]),
  removedAliases: z.array(OverlayAliasSchema).default([]),
});

export type Overlay = z.infer<typeof OverlaySchema>;

/** Reads and validates the Overlay file at `path`. */
export async function readOverlay(path: string): Promise<Overlay> {
  const parsed = OverlaySchema.safeParse(JSON.parse(await readFile(path, "utf8")));
  if (!parsed.success) throw new Error(`Overlay is malformed:\n${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

/** Same-as links by Entity `id`: each links to the `id`s of the Entities it denotes the same territory as. */
export type SameAsLinks = ReadonlyMap<string, readonly string[]>;

/**
 * Validates the Overlay's Same-as links against the Entities built from the Snapshots and writes each on both sides,
 * so a link can't be one-sided (ADR-0003), adding a problem for each dangling or repeated link.
 */
export function linkSameAs(
  overlay: Overlay,
  {
    countryIds,
    subdivisionIds,
  }: { countryIds: ReadonlySet<string>; subdivisionIds: ReadonlySet<string> },
  problems: string[],
): SameAsLinks {
  const sameAs = new Map<string, string[]>();
  for (const { entities } of overlay.sameAs) {
    const [country, subdivision] = entities;
    const dangling = [
      ...(countryIds.has(country) ? [] : [country]),
      ...(subdivisionIds.has(subdivision) ? [] : [subdivision]),
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
    append(sameAs, country, subdivision);
    append(sameAs, subdivision, country);
  }
  for (const links of sameAs.values()) links.sort();
  return sameAs;
}
