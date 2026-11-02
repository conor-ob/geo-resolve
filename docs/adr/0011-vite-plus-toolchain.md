# Vite+ toolchain in a pnpm monorepo

The repository is a pnpm workspace with the published package in `packages/geo-resolve` and the private codegen in `tools/codegen`, so codegen's heavy dependencies never enter the published package's dependency graph. Tooling is Vite+ (MIT): `vp run` for workspace tasks, Vitest for tests, `vp pack` (tsdown) for builds, and Oxlint and Oxfmt for linting and formatting, with Oxlint's type-aware rules enabled. Changesets, API Extractor, `@arethetypeswrong/core` and `publint` (both run by `vp pack`) are used alongside it, and releases publish from GitHub Actions with npm provenance.

This deliberately avoids the more common Turborepo and Biome pairing. With two workspaces, Turborepo's caching earns little and the expensive step (`fetch`) must not be cached anyway. Vite+ replaces five separately versioned tools with one, and type-aware linting catches bugs Biome can't.

## Consequences

Vite+ is in alpha. Its version is pinned exactly and upgraded deliberately. The risk is contained because it is development tooling only (the published package has no runtime dependencies) and every tool inside it exists standalone, so if Vite+ stalls the wrapper can be replaced with Oxlint, Oxfmt, Vitest and tsdown directly without reworking the setup.
