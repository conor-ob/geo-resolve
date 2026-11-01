import { aliasesOf } from "./data-pack.ts";
import { normalise } from "./normalise.ts";
import type { DataPack, Entity, Kind, ResolveOptions } from "./types.ts";

/** What a Resolver is built from. */
export interface ResolverOptions {
  /** The Data packs whose Entities the Resolver resolves to. An Entity in several packs counts once. */
  readonly data: readonly DataPack[];
}

/** A configured view over a chosen set of Entities, against which Inputs are resolved. Its functions work detached from it. */
export interface Resolver {
  /** Resolves an Input to the single Entity it denotes, or `null` when there is none or it is ambiguous. */
  readonly resolve: (input: string, options?: ResolveOptions) => Entity | null;
  /** Resolves an Input to every Candidate, ordered by Kind then `id`, so "not found" can be told from "ambiguous". */
  readonly resolveAll: (input: string, options?: ResolveOptions) => Entity[];
  /** Resolves an Input and returns its Alpha-2 code, or `null` when it doesn't resolve or has none. */
  readonly toAlpha2: (input: string, options?: ResolveOptions) => string | null;
  /** Resolves an Input and returns its Alpha-3 code, or `null` when it doesn't resolve or has none. */
  readonly toAlpha3: (input: string, options?: ResolveOptions) => string | null;
  /** Resolves an Input and returns its three-digit Numeric code, or `null` when it doesn't resolve or has none. */
  readonly toNumeric: (input: string, options?: ResolveOptions) => string | null;
  /** Resolves an Input and returns its Subdivision code, or `null` when it doesn't resolve or has none. */
  readonly toSubdivisionCode: (input: string, options?: ResolveOptions) => string | null;
  /** Resolves an Input and returns its English Name, or `null` when it doesn't resolve. */
  readonly toName: (input: string, options?: ResolveOptions) => string | null;
}

/** The order `resolveAll` presents Candidates in. Presentation only: `resolve` never uses it to pick. */
const KIND_ORDER: readonly Kind[] = ["country", "subdivision", "historic-country", "territory"];

function byKindThenId(a: Entity, b: Entity): number {
  return (
    KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/** The codes, Name and Aliases an Input can match an Entity by. A bare Subdivision code suffix is not one. */
function matchKeys(entity: Entity): string[] {
  return [...ownKeys(entity), ...aliasesOf(entity)];
}

/** The codes and Name an Input can match an Entity by, read from the Entity itself. */
function ownKeys(entity: Entity): string[] {
  switch (entity.kind) {
    case "country":
      return [entity.id, entity.alpha2, entity.alpha3, entity.numeric, entity.name];
    case "subdivision":
      return [entity.id, entity.code, entity.name];
    case "historic-country":
      return [
        entity.id,
        entity.alpha4,
        entity.alpha2,
        entity.alpha3,
        entity.numeric,
        entity.name,
      ].filter((key) => key !== undefined);
    default:
      // A Kind this version doesn't know, from a hand-built pack, never matches.
      return [];
  }
}

/** Builds an independent Resolver over the Entities in `data`. Its index is built on first use and is private to it. */
export function createResolver({ data }: ResolverOptions): Resolver {
  // Later changes to the caller's array don't reach this Resolver.
  const packs = [...data];
  let index: Map<string, Entity[]> | undefined;

  function buildIndex(): Map<string, Entity[]> {
    const built = new Map<string, Entity[]>();
    for (const entity of new Set(packs.flat())) {
      // Shipped Data packs are frozen already; hand-built ones aren't.
      const frozen = Object.freeze(entity);
      for (const key of new Set(matchKeys(frozen).map(normalise))) {
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

  function resolve(input: string, options?: ResolveOptions): Entity | null {
    const candidates = resolveAll(input, options);
    return candidates.length === 1 ? candidates[0]! : null;
  }

  return {
    resolve,
    resolveAll,
    toAlpha2(input, options) {
      const entity = resolve(input, options);
      return entity !== null && "alpha2" in entity ? entity.alpha2 : null;
    },
    toAlpha3(input, options) {
      const entity = resolve(input, options);
      return entity !== null && "alpha3" in entity ? (entity.alpha3 ?? null) : null;
    },
    toNumeric(input, options) {
      const entity = resolve(input, options);
      return entity !== null && "numeric" in entity ? (entity.numeric ?? null) : null;
    },
    toSubdivisionCode(input, options) {
      const entity = resolve(input, options);
      return entity !== null && "code" in entity ? entity.code : null;
    },
    toName(input, options) {
      return resolve(input, options)?.name ?? null;
    },
  };
}
