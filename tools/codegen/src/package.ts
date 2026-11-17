// The geo-resolve modules codegen runs, imported from the package's source rather than through its `exports`, which
// expose neither `dataPack` nor `normalise`. Importing them, not copying them, keeps one definition of how an Input
// matches an Entity, so the Alias rules can't drift from what `resolve` does (ADR-0013).
export { dataPack } from "../../../packages/geo-resolve/src/data-pack.ts";
export type { FormerCodes } from "../../../packages/geo-resolve/src/data-pack.ts";
export { normalise } from "../../../packages/geo-resolve/src/normalise.ts";
export { createResolver } from "../../../packages/geo-resolve/src/resolver.ts";
