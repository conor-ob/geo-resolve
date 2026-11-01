import countries from "./data/countries.json" with { type: "json" };
import { createResolver } from "./resolver.ts";
import type { Entity, ResolveOptions } from "./types.ts";

export type { Country, Entity, Kind, KnownKind, ResolveOptions } from "./types.ts";

const resolver = createResolver(countries as readonly Entity[]);

/** Resolves an Input to the single Entity it denotes, or `null` when there is none or it is ambiguous. */
export const resolve = resolver.resolve;

/** Resolves an Input to every Candidate, ordered by Kind then `id`, so "not found" can be told from "ambiguous". */
export const resolveAll = resolver.resolveAll;

/** Resolves an Input and returns its Alpha-2 code, or `null` when it doesn't resolve or has none. */
export function toAlpha2(input: string, options?: ResolveOptions): string | null {
  return resolve(input, options)?.alpha2 ?? null;
}

/** Resolves an Input and returns its Alpha-3 code, or `null` when it doesn't resolve or has none. */
export function toAlpha3(input: string, options?: ResolveOptions): string | null {
  return resolve(input, options)?.alpha3 ?? null;
}

/** Resolves an Input and returns its three-digit Numeric code, or `null` when it doesn't resolve or has none. */
export function toNumeric(input: string, options?: ResolveOptions): string | null {
  return resolve(input, options)?.numeric ?? null;
}

/** Resolves an Input and returns its English Name, or `null` when it doesn't resolve. */
export function toName(input: string, options?: ResolveOptions): string | null {
  return resolve(input, options)?.name ?? null;
}
