import type {
  Country,
  Entity,
  HistoricCountry,
  KnownScheme,
  Subdivision,
  Territory,
} from "geo-resolve";
import { append } from "./lists.ts";
import type { Overlay, SameAsLinks } from "./overlay.ts";
import { createResolver, dataPack, normalise, type FormerCodes } from "./package.ts";
import type { AliasLanguage } from "./wikidata.ts";

/** Where an Alias candidate came from: a CLDR variant or short name (ADR-0014), or a Wikidata label in one language. */
export type AliasOrigin =
  | { readonly source: "CLDR" }
  | { readonly source: "Wikidata"; readonly item: string; readonly lang: AliasLanguage };

/** A label a Source gives the Entity with this `id`, which becomes its Alias unless an Alias rule or the Overlay drops it. */
export interface AliasCandidate {
  readonly id: string;
  readonly alias: string;
  readonly origin: AliasOrigin;
}

/** An Alias, with the Source it came from, for the build report. */
export interface AliasSource {
  id: string;
  alias: string;
  source: string;
}

/** A candidate that isn't an Alias of its Entity, because a rule or the Overlay drops it, with why, for the build report. */
export interface DroppedAlias {
  id: string;
  alias: string;
  reason: string;
}

/** The Entities the Alias rules check candidates against, with their Code system codes joined. */
export interface AliasRuleEntities {
  /** The Entities that hold Aliases, with Territories. */
  countries: readonly Country[];
  territories: readonly Territory[];
  subdivisions: readonly Subdivision[];
  historicCountries: readonly HistoricCountry[];
  /** The Aliases the Overlay lists on each Historic country, by `id`. */
  historicAliases: ReadonlyMap<string, readonly string[]>;
  /** The former codes of Countries that still exist, by `id` (ADR-0003). */
  formerCodes: ReadonlyMap<string, FormerCodes>;
  sameAs: SameAsLinks;
}

/** Every Scheme an Input can match a code in, so a Resolver query can tell codes from Names and Aliases. */
const SCHEMES = Object.keys({
  alpha2: true,
  alpha3: true,
  numeric: true,
  "subdivision-code": true,
  alpha4: true,
  ioc: true,
  fifa: true,
} satisfies Record<KnownScheme, true>);

/**
 * A Resolver over copies of `entities`, with the Aliases and former codes in `aliases` and `formerCodes` keyed by
 * `id`. Copies, since a Data pack freezes its Entities and records their Aliases against them.
 */
function resolverOver(
  entities: readonly Entity[],
  aliases: ReadonlyMap<string, readonly string[]>,
  formerCodes: ReadonlyMap<string, FormerCodes>,
) {
  return createResolver({
    data: [
      dataPack(
        entities.map((entity) => ({ ...entity })),
        Object.fromEntries(aliases),
        Object.fromEntries(formerCodes),
      ),
    ],
  });
}

/** The Aliases each Country and Territory ships, and the candidates the rules or the Overlay dropped. */
export interface AliasRulesResult {
  aliases: AliasSource[];
  dropped: DroppedAlias[];
}

/** A candidate as the rules rank it: the Overlay's additions first, then CLDR's names, then Wikidata's labels. */
type Row = AliasCandidate | { id: string; alias: string; origin: { source: "Overlay" } };

/** The Source a row names in the build report, such as `Wikidata Q183`. */
function sourceLabel({ origin }: Row): string {
  return origin.source === "Wikidata" ? `Wikidata ${origin.item}` : origin.source;
}

/** Whether an Alias reads as a name: letters with spaces and punctuation, not a flag, time zone or calling code. */
function isName(alias: string): boolean {
  return /^[\p{L}\p{M} .,'’‘&()\-–]+$/u.test(alias);
}

/** Whether every letter of an Alias is Latin script, as a multilingual (`mul`) one must be to read as English. */
function isLatin(alias: string): boolean {
  return /^[\p{Script=Latin}\P{L}]*$/u.test(alias);
}

/** Keys an Overlay entry by Entity and match key, so it matches the Alias whatever its case or accents. */
function entityAliasKey(entity: string, alias: string): string {
  return `${entity}\t${normalise(alias)}`;
}

/** How many capital letters an Alias has, to choose between Aliases that differ only in case. */
function countCapitals(alias: string): number {
  return alias.match(/\p{Lu}/gu)?.length ?? 0;
}

/** Entity `id`s sorted and joined for a reason or problem, such as `CD and CG`. */
function joinIds(ids: Iterable<string>): string {
  return [...new Set(ids)].sort().join(" and ");
}

/**
 * Applies the Alias rules (ADR-0013) to every candidate from the Sources and to the Overlay's Alias additions and
 * removals, for the Countries and Territories in `entities`. A candidate is dropped when it isn't name-shaped, is a
 * multilingual (`mul`) label not in Latin script, is a code, names a Historic country, is another Entity's Name, or is
 * an Alias of more than one Entity; Same-as links exempt the Entities they join. Every problem it finds, such as a
 * stale Overlay entry or an Overlay addition that breaks a rule, is added to `problems` rather than thrown.
 */
export function applyAliasRules({
  entities,
  candidates,
  overlay,
  problems,
}: {
  entities: AliasRuleEntities;
  candidates: readonly AliasCandidate[];
  overlay: Pick<Overlay, "addedAliases" | "removedAliases">;
  problems: string[];
}): AliasRulesResult {
  const {
    countries,
    territories,
    subdivisions,
    historicCountries,
    historicAliases,
    formerCodes,
    sameAs,
  } = entities;

  // The rules ask a Resolver what a candidate would match, so they apply exactly the matching `resolve` does:
  // every code (former codes included), Name and Historic country Alias the Data packs ship.
  const allEntities = [...countries, ...territories, ...subdivisions, ...historicCountries];
  const withoutAliases = resolverOver(allEntities, historicAliases, formerCodes);
  const entityNames = new Map([...countries, ...territories].map(({ id, name }) => [id, name]));
  /** The Entities in `others` other than `id` and those a Same-as link joins to it. */
  const unlinked = (id: string, others: readonly string[]) =>
    others.filter((other) => other !== id && !sameAs.get(id)?.includes(other));
  // Aliases are names only: one that is a code would shadow the code's own Entity, and one that names a
  // Historic country would map it to a current Country, which geo-resolve never does (ADR-0003). One that is another
  // Entity's Name would make a common Input an Ambiguous input, which the default English Resolver never has
  // (ADR-0013), unless a Same-as link joins the two Entities.
  /** Why `alias` can't be an Alias of the Entity with this `id`, judged by what it already matches, or `undefined`. */
  const matchReason = (id: string, alias: string): string | undefined => {
    const coded = new Set(withoutAliases.resolveAll(alias, { from: SCHEMES }));
    const key = normalise(alias);
    // A Territory's `id` is in no Scheme (ADR-0012), but is still a code.
    const matched = withoutAliases.resolveAll(alias);
    for (const entity of matched)
      if (entity.kind === "territory" && normalise(entity.id) === key) coded.add(entity);
    if (coded.size > 0) return `a code of ${joinIds([...coded].map(({ id }) => id))}`;
    const historic = matched.find(({ kind }) => kind === "historic-country");
    if (historic !== undefined)
      return normalise(historic.name) === key
        ? `the Name of the Historic country ${historic.id}`
        : `an Alias of the Historic country ${historic.id}`;
    const named = unlinked(
      id,
      matched.map((entity) => entity.id),
    );
    return named.length > 0 ? `the Name of ${joinIds(named)}` : undefined;
  };

  // Overlay removals take an Alias from the Sources before the shared-Alias check below, so removing a shared Alias
  // from all but one Entity gives it back to that one (ADR-0013). Each one must match an Alias from the Sources that
  // no rule drops, so a stale removal is noticed when upstream fixes the label.
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
    const key = entityAliasKey(entity, alias);
    if (problem !== undefined) problems.push(problem);
    else if (removals.has(key)) problems.push(`${label} from ${entity} is listed twice`);
    else removals.set(key, { entity, alias, reason, matched: false });
  }
  // Overlay additions give a Country or Territory an Alias the Sources lack, such as one Wikidata dropped. They must
  // pass the same rules, so the Overlay can't make an Input ambiguous either.
  const additions = new Map<string, Row[]>();
  const added = new Set<string>();
  for (const { entity, alias } of overlay.addedAliases) {
    const label = `Overlay Alias ${alias}`;
    const problem = notAliasHolder(label, entity);
    const key = entityAliasKey(entity, alias);
    if (problem !== undefined) problems.push(problem);
    else if (added.has(key)) problems.push(`${label} for ${entity} is listed twice`);
    else {
      added.add(key);
      append(additions, entity, { id: entity, alias, origin: { source: "Overlay" } });
    }
  }

  const byEntity = new Map<string, AliasCandidate[]>();
  for (const candidate of candidates) append(byEntity, candidate.id, candidate);
  /** Orders a candidate CLDR first, then Wikidata in the order `ALIAS_LANGUAGES` ranks its language. */
  const rank = ({ origin }: AliasCandidate) =>
    origin.source === "CLDR" ? -1 : origin.lang === "en" ? 0 : 1;

  const aliases: AliasSource[] = [];
  const dropped: DroppedAlias[] = [];
  for (const id of [...entityNames.keys()].sort()) {
    const keys = new Set([normalise(entityNames.get(id)!)]);
    const fromSources = (byEntity.get(id) ?? [])
      .slice()
      .sort((a, b) => rank(a) - rank(b) || (a.alias < b.alias ? -1 : 1));
    const wikidataRows = fromSources.filter(({ origin }) => origin.source === "Wikidata");
    /** The Overlay's additions still waiting for a Source to give the same Alias, which makes them stale. */
    const pending = new Map(
      (additions.get(id) ?? []).map((row) => [normalise(row.alias), row.alias]),
    );
    for (const row of [...(additions.get(id) ?? []), ...fromSources]) {
      const key = normalise(row.alias);
      if (keys.has(key)) {
        if (row.origin.source === "Overlay")
          problems.push(`Overlay Alias ${row.alias} for ${id} is its Name`);
        else if (pending.has(key)) {
          problems.push(
            `Overlay Alias ${pending.get(key)} for ${id} is also from ${sourceLabel(row)}, so it is no longer needed`,
          );
          pending.delete(key);
        }
        continue;
      }
      keys.add(key);
      // Wikidata labels that differ only in case, in any language, ship the one with the most capitals, ties going
      // to the order above, so the casing that ships doesn't depend on which variants upstream happens to keep. Case
      // only, not the whole match key, so an English spelling still wins on accents. The row that took the match key
      // still decides the script rule by its language, as casing never changes a script. CLDR's names and the
      // Overlay's additions ship as written.
      const alias =
        row.origin.source === "Wikidata"
          ? wikidataRows
              .filter((other) => other.alias.toLowerCase() === row.alias.toLowerCase())
              .reduce((best, other) =>
                countCapitals(other.alias) > countCapitals(best.alias) ? other : best,
              ).alias
          : row.alias;
      const reason = !isName(alias)
        ? "not a name"
        : row.origin.source === "Wikidata" && row.origin.lang === "mul" && !isLatin(alias)
          ? "not in Latin script"
          : matchReason(id, alias);
      const removal = removals.get(entityAliasKey(id, row.alias));
      if (removal !== undefined) removal.matched = true;
      const source = sourceLabel(row);
      if (row.origin.source === "Overlay") {
        // A reviewer added it, so breaking a rule fails the build rather than quietly dropping it.
        if (removal !== undefined)
          problems.push(`Overlay Alias ${alias} for ${id} is also removed by the Overlay`);
        else if (reason !== undefined)
          problems.push(`Overlay Alias ${alias} for ${id} is ${reason}`);
        else aliases.push({ id, alias, source });
      } else if (reason !== undefined) {
        if (removal !== undefined)
          problems.push(
            `Overlay removal of ${removal.alias} from ${id} matches an Alias already dropped as ${reason}, so it is no longer needed`,
          );
        dropped.push({ id, alias, reason });
      } else if (removal !== undefined)
        dropped.push({ id, alias, reason: `removed by the Overlay: ${removal.reason}` });
      else aliases.push({ id, alias, source });
    }
  }

  for (const { entity, alias, matched } of removals.values()) {
    if (!matched)
      problems.push(
        `Overlay removal of ${alias} from ${entity} matches no Alias from the Sources, so it is no longer needed`,
      );
  }

  // A Resolver over every Entity with the Aliases that passed: an Alias that still has a Candidate other than its own
  // Entity and those Same-as links join it to is an Alias of more than one Entity, and is dropped from each.
  const kept = new Map<string, string[]>();
  for (const { id, alias } of aliases) append(kept, id, alias);
  for (const [id, names] of historicAliases) kept.set(id, [...names]);
  const withAliases = resolverOver(allEntities, kept, formerCodes);
  const unshared = aliases.filter(({ id, alias, source }) => {
    const shared = unlinked(
      id,
      withAliases.resolveAll(alias).map((entity) => entity.id),
    );
    if (shared.length === 0) return true;
    if (source === "Overlay")
      problems.push(`Overlay Alias ${alias} for ${id} is also an Alias of ${joinIds(shared)}`);
    else dropped.push({ id, alias, reason: `also an Alias of ${joinIds(shared)}` });
    return false;
  });

  return { aliases: unshared, dropped };
}
