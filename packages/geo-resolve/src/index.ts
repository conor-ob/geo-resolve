import countries from "./data/countries.ts";
import { createResolver } from "./resolver.ts";

export { createResolver } from "./resolver.ts";
export type { Resolver, ResolverOptions } from "./resolver.ts";
export type {
  Codes,
  Country,
  DataPack,
  Entity,
  HistoricCountry,
  Kind,
  KnownCodeSystem,
  KnownKind,
  ResolveOptions,
  Subdivision,
} from "./types.ts";

// The default entry resolves Countries in English only; other Data packs are opt-in (ADR-0005).
const resolver = createResolver({ data: [countries] });

/** Resolves an Input to the single Entity it denotes, or `null` when there is none or it is ambiguous. */
export const resolve = resolver.resolve;

/** Resolves an Input to every Candidate, ordered by Kind then `id`, so "not found" can be told from "ambiguous". */
export const resolveAll = resolver.resolveAll;

/** Resolves an Input and returns its Alpha-2 code, or `null` when it doesn't resolve or has none. */
export const toAlpha2 = resolver.toAlpha2;

/** Resolves an Input and returns its Alpha-3 code, or `null` when it doesn't resolve or has none. */
export const toAlpha3 = resolver.toAlpha3;

/** Resolves an Input and returns its three-digit Numeric code, or `null` when it doesn't resolve or has none. */
export const toNumeric = resolver.toNumeric;

/** Resolves an Input and returns its Subdivision code, or `null` when it doesn't resolve or has none. */
export const toSubdivisionCode = resolver.toSubdivisionCode;

/** Resolves an Input and returns its English Name, or `null` when it doesn't resolve. */
export const toName = resolver.toName;
