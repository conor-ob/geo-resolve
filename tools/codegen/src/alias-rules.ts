import type { Country, HistoricCountry, Subdivision, Territory } from "geo-resolve";
import { append } from "./lists.ts";
import type { Overlay, SameAsLinks } from "./overlay.ts";
import { matchKey, type AliasLanguage } from "./wikidata.ts";

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
  sameAs: SameAsLinks;
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
  return `${entity}\t${matchKey(alias)}`;
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
  const { countries, territories, subdivisions, historicCountries, historicAliases, sameAs } =
    entities;

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
  for (const { id } of territories) holdsCode(id, id);
  for (const { id, codes } of [...countries, ...subdivisions, ...territories])
    for (const code of Object.values(codes ?? {})) if (code !== undefined) holdsCode(code, id);
  const historicNames = new Map<string, string>();
  for (const { id, name } of historicCountries)
    historicNames.set(matchKey(name), `the Name of the Historic country ${id}`);
  for (const [id, aliases] of historicAliases) {
    for (const alias of aliases)
      historicNames.set(matchKey(alias), `an Alias of the Historic country ${id}`);
  }
  const entityNames = new Map([...countries, ...territories].map(({ id, name }) => [id, name]));
  // An Alias that is a different Entity's Name, or another Entity's Alias, would make a common Input an Ambiguous
  // input, which the default English Resolver never has (ADR-0013), unless a Same-as link joins the two Entities.
  const nameHolders = new Map<string, string[]>();
  for (const { id, name } of [...countries, ...territories, ...subdivisions])
    append(nameHolders, matchKey(name), id);
  /** The Entities in `others` other than `id` and those a Same-as link joins to it. */
  const unlinked = (id: string, others: readonly string[]) =>
    others.filter((other) => other !== id && !sameAs.get(id)?.includes(other));

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
    const keys = new Set([matchKey(entityNames.get(id)!)]);
    const fromSources = (byEntity.get(id) ?? [])
      .slice()
      .sort((a, b) => rank(a) - rank(b) || (a.alias < b.alias ? -1 : 1));
    const wikidataRows = fromSources.filter(({ origin }) => origin.source === "Wikidata");
    /** The Overlay's additions still waiting for a Source to give the same Alias, which makes them stale. */
    const pending = new Map(
      (additions.get(id) ?? []).map((row) => [matchKey(row.alias), row.alias]),
    );
    for (const row of [...(additions.get(id) ?? []), ...fromSources]) {
      const key = matchKey(row.alias);
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
      const holders = codeHolders.get(key);
      const named = unlinked(id, nameHolders.get(key) ?? []);
      const reason = !isName(alias)
        ? "not a name"
        : row.origin.source === "Wikidata" && row.origin.lang === "mul" && !isLatin(alias)
          ? "not in Latin script"
          : holders !== undefined
            ? `a code of ${joinIds(holders)}`
            : (historicNames.get(key) ??
              (named.length > 0 ? `the Name of ${joinIds(named)}` : undefined));
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

  const aliasHolders = new Map<string, string[]>();
  for (const { id, alias } of aliases) append(aliasHolders, matchKey(alias), id);
  const unshared = aliases.filter(({ id, alias, source }) => {
    const shared = unlinked(id, aliasHolders.get(matchKey(alias))!);
    if (shared.length === 0) return true;
    if (source === "Overlay")
      problems.push(`Overlay Alias ${alias} for ${id} is also an Alias of ${joinIds(shared)}`);
    else dropped.push({ id, alias, reason: `also an Alias of ${joinIds(shared)}` });
    return false;
  });

  return { aliases: unshared, dropped };
}
