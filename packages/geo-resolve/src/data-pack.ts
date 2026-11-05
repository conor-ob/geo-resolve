import type { Entity, Scheme } from "./types.ts";

/** Aliases match an Input but aren't exposed on Entities (ADR-0003), so they are kept beside them here. */
const entityAliases = new WeakMap<Entity, readonly string[]>();

/** Former codes of Countries that still exist, by Scheme. Like Aliases, they aren't exposed on Entities (ADR-0003). */
const entityFormerCodes = new WeakMap<Entity, FormerCodes>();

/** An Entity's former codes, keyed by the Scheme that issued them, such as `{ alpha3: ["ROM"] }` for Romania. */
export type FormerCodes = { readonly [scheme in Scheme]?: readonly string[] };

/**
 * Freezes a Data pack and its Entities, so a pack shared between Resolvers can't be corrupted through any of them,
 * and records each Entity's Aliases from `aliases` and former codes from `formerCodes`, both keyed by Entity `id`.
 */
export function dataPack<T extends Entity>(
  entities: readonly T[],
  aliases: { readonly [id: string]: readonly string[] } = {},
  formerCodes: { readonly [id: string]: FormerCodes } = {},
): readonly T[] {
  for (const entity of entities) {
    Object.freeze(entity);
    const names = aliases[entity.id];
    if (names !== undefined) entityAliases.set(entity, names);
    const codes = formerCodes[entity.id];
    if (codes !== undefined) entityFormerCodes.set(entity, codes);
  }
  return Object.freeze(entities);
}

/** The Aliases an Entity from a shipped Data pack can also be resolved by. */
export function aliasesOf(entity: Entity): readonly string[] {
  return entityAliases.get(entity) ?? [];
}

/** The former codes an Entity from a shipped Data pack can also be resolved by, keyed by Scheme. */
export function formerCodesOf(entity: Entity): FormerCodes {
  return entityFormerCodes.get(entity) ?? {};
}
