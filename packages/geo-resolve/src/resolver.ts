import { aliasesOf, formerCodesOf } from "./data-pack.ts";
import { normalise } from "./normalise.ts";
import type {
  Country,
  DataPack,
  Entity,
  Kind,
  ResolveOptions,
  Scheme,
  Subdivision,
  Territory,
} from "./types.ts";

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

/** One way an Input can match an Entity: through a code in a Scheme, or through a Name or Alias (no Scheme). */
interface Match {
  readonly entity: Entity;
  readonly scheme: Scheme | undefined;
}

/** A Resolver's lookups: Matches by normalised match key, and Entities by `id` for walking Parents. */
interface Index {
  readonly byKey: ReadonlyMap<string, Match[]>;
  readonly byId: ReadonlyMap<string, Entity>;
}

/** A key an Input can match an Entity by, with the Scheme it is a code in, if any. */
type MatchKey = readonly [key: string, scheme: Scheme | undefined];

/** The codes, Name, former codes and Aliases an Input can match an Entity by. A bare Subdivision code suffix is not one. */
function matchKeys(entity: Entity): MatchKey[] {
  return [
    ...ownKeys(entity),
    ...Object.entries(formerCodesOf(entity)).flatMap(([scheme, codes = []]) =>
      codes.map((code): MatchKey => [code, scheme]),
    ),
    ...aliasesOf(entity).map((alias): MatchKey => [alias, undefined]),
  ];
}

/** The codes and Name an Input can match an Entity by, read from the Entity itself. An `id` is in its Kind's id Scheme. */
function ownKeys(entity: Entity): MatchKey[] {
  switch (entity.kind) {
    case "country":
      return [
        [entity.id, "alpha2"],
        [entity.alpha2, "alpha2"],
        [entity.alpha3, "alpha3"],
        [entity.numeric, "numeric"],
        [entity.name, undefined],
        ...codeSystemKeys(entity),
      ];
    case "subdivision":
      return [
        [entity.id, "subdivision-code"],
        [entity.code, "subdivision-code"],
        [entity.name, undefined],
        ...codeSystemKeys(entity),
      ];
    case "historic-country": {
      const keys: MatchKey[] = [
        [entity.id, "alpha4"],
        [entity.alpha4, "alpha4"],
        [entity.alpha2, "alpha2"],
        [entity.name, undefined],
      ];
      if (entity.alpha3 !== undefined) keys.push([entity.alpha3, "alpha3"]);
      if (entity.numeric !== undefined) keys.push([entity.numeric, "numeric"]);
      return keys;
    }
    case "territory":
      // A Territory's `id` is user-assigned, not an ISO code, so it is in no Scheme (ADR-0012).
      return [[entity.id, undefined], [entity.name, undefined], ...codeSystemKeys(entity)];
    default:
      // A Kind this version doesn't know, from a hand-built pack, never matches.
      return [];
  }
}

/** An Entity's codes in every Code system, including ones this version doesn't know, from a newer or hand-built pack. */
function codeSystemKeys(entity: Country | Subdivision | Territory): MatchKey[] {
  return Object.entries(entity.codes ?? {}).flatMap(([system, code]): MatchKey[] =>
    typeof code === "string" ? [[code, system]] : [],
  );
}

/** Builds an independent Resolver over the Entities in `data`. Its index is built on first use and is private to it. */
export function createResolver({ data }: ResolverOptions): Resolver {
  // Later changes to the caller's array don't reach this Resolver.
  const packs = [...data];
  let index: Index | undefined;

  function buildIndex(): Index {
    const byKey = new Map<string, Match[]>();
    const byId = new Map<string, Entity>();
    for (const entity of new Set(packs.flat())) {
      // Shipped Data packs are frozen already; hand-built ones aren't.
      const frozen = Object.freeze(entity);
      byId.set(frozen.id, frozen);
      for (const [key, scheme] of matchKeys(frozen)) {
        const normalised = normalise(key);
        const matches = byKey.get(normalised) ?? [];
        matches.push({ entity: frozen, scheme });
        byKey.set(normalised, matches);
      }
    }
    return { byKey, byId };
  }

  /** Whether `entity` is the Entity with this `id`, or sits under it at any depth, following Parents. */
  function isWithin(entity: Entity, id: string, byId: ReadonlyMap<string, Entity>): boolean {
    if (entity.id === id) return true;
    if (entity.kind !== "subdivision") return false;
    // The Country holds every Subdivision, even when an intermediate Parent isn't loaded.
    if (entity.country === id) return true;
    // Hand-built packs can loop their Parents, so stop at one already seen.
    const seen = new Set<Entity>();
    let current: Entity | undefined = entity;
    while (current?.kind === "subdivision" && !seen.has(current)) {
      if (current.parent === id) return true;
      seen.add(current);
      current = byId.get(current.parent);
    }
    return false;
  }

  function resolveAll(input: string, options: ResolveOptions = {}): Entity[] {
    const { byKey, byId } = (index ??= buildIndex());
    const { kinds, within, from } = options;
    const matchesFrom = ({ scheme }: Match) =>
      from === undefined || (scheme !== undefined && from.includes(scheme));
    const key = normalise(input);
    const candidates = new Set(
      byKey
        .get(key)
        ?.filter(matchesFrom)
        .map(({ entity }) => entity),
    );
    if (within !== undefined) {
      // A bare suffix ("CA") matches as the full Subdivision code in the Country of `within` ("US-CA").
      const suffixCode = normalise(`${within.split("-")[0]}-${key}`);
      for (const match of byKey.get(suffixCode) ?? []) {
        // The key may also be a Name; only the Subdivision code counts.
        if (match.scheme === "subdivision-code" && matchesFrom(match)) candidates.add(match.entity);
      }
    }
    return [...candidates]
      .filter(
        (entity) =>
          (kinds === undefined || kinds.includes(entity.kind)) &&
          (within === undefined || isWithin(entity, within, byId)),
      )
      .sort(byKindThenId);
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
