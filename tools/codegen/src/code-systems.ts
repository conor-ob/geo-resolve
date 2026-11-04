import type { KnownCodeSystem } from "geo-resolve";
import { z } from "zod";

/**
 * The Code systems geo-resolve builds, keyed as in an Entity's `codes`, in the order the build report lists them,
 * with the name the report gives each and the article that name takes.
 */
export const CODE_SYSTEMS = {
  ioc: { name: "IOC", article: "an" },
  fifa: { name: "FIFA", article: "a" },
} as const satisfies Record<KnownCodeSystem, { name: string; article: "a" | "an" }>;
export type CodeSystem = keyof typeof CODE_SYSTEMS;
export const CODE_SYSTEM_KEYS = Object.keys(CODE_SYSTEMS) as [CodeSystem, ...CodeSystem[]];

/** A code in a non-ISO Code system, such as the IOC's `GER`. */
export const CodeSystemCodeSchema = z.string().regex(/^[A-Z]{3}$/, "must be three capital letters");

/** A Code system's key, such as `ioc`. */
export const CodeSystemSchema = z.enum(CODE_SYSTEM_KEYS);

/** Code systems named for a build problem, such as `IOC and FIFA`. */
export function codeSystemNames(systems: readonly CodeSystem[]): string {
  return systems.map((system) => CODE_SYSTEMS[system].name).join(" and ") || "no Code system";
}
