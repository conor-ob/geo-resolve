import type { Entity } from "./types.ts";

/** Aliases match an Input but aren't exposed on Entities (ADR-0003), so they are kept beside them here. */
const entityAliases = new WeakMap<Entity, readonly string[]>();

/**
 * Freezes a Data pack and its Entities, so a pack shared between Resolvers can't be corrupted through any of them,
 * and records each Entity's Aliases from `aliases`, keyed by Entity `id`.
 */
export function dataPack<T extends Entity>(
  entities: readonly T[],
  aliases: { readonly [id: string]: readonly string[] } = {},
): readonly T[] {
  for (const entity of entities) {
    Object.freeze(entity);
    const names = aliases[entity.id];
    if (names !== undefined) entityAliases.set(entity, names);
  }
  return Object.freeze(entities);
}

/** The Aliases an Entity from a shipped Data pack can also be resolved by. */
export function aliasesOf(entity: Entity): readonly string[] {
  return entityAliases.get(entity) ?? [];
}
