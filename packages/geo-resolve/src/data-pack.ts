import type { Entity } from "./types.ts";

/** Freezes a Data pack and its Entities, so a pack shared between Resolvers can't be corrupted through any of them. */
export function dataPack<T extends Entity>(entities: readonly T[]): readonly T[] {
  for (const entity of entities) Object.freeze(entity);
  return Object.freeze(entities);
}
