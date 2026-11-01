import { normalise } from "./normalise.ts";
import type { Entity, Kind, ResolveOptions } from "./types.ts";

interface Resolver {
  resolve: (input: string, options?: ResolveOptions) => Entity | null;
  resolveAll: (input: string, options?: ResolveOptions) => Entity[];
}

/** The order `resolveAll` presents Candidates in. Presentation only: `resolve` never uses it to pick. */
const KIND_ORDER: readonly Kind[] = ["country", "subdivision", "historic-country", "territory"];

function byKindThenId(a: Entity, b: Entity): number {
  return (
    KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/** Builds a Resolver over `entities`. Its index is built on first use and is private to it. */
export function createResolver(entities: readonly Entity[]): Resolver {
  let index: Map<string, Entity[]> | undefined;

  function buildIndex(): Map<string, Entity[]> {
    const built = new Map<string, Entity[]>();
    for (const entity of entities) {
      const frozen = Object.freeze(entity);
      const keys = [frozen.id, frozen.alpha2, frozen.alpha3, frozen.numeric, frozen.name].map(
        normalise,
      );
      for (const key of new Set(keys)) {
        const candidates = built.get(key) ?? [];
        candidates.push(frozen);
        built.set(key, candidates);
      }
    }
    for (const candidates of built.values()) candidates.sort(byKindThenId);
    return built;
  }

  function resolveAll(input: string, options: ResolveOptions = {}): Entity[] {
    index ??= buildIndex();
    const candidates = index.get(normalise(input)) ?? [];
    const { kinds } = options;
    return kinds === undefined
      ? [...candidates]
      : candidates.filter((entity) => kinds.includes(entity.kind));
  }

  return {
    resolve(input, options) {
      const candidates = resolveAll(input, options);
      return candidates.length === 1 ? candidates[0]! : null;
    },
    resolveAll,
  };
}
