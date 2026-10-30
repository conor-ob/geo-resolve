# ESM-only with zero runtime dependencies

The published package is ESM-only and has no runtime dependencies. Data is validated at build time (zod lives only in codegen and tests), so nothing needs validating at runtime. It targets current Node LTS lines (22 and 24), browsers, Deno, Bun and edge workers. CI runs a smoke test against the built package in Bun, Deno and a Vite browser bundle so the claim stays true. Dropping CommonJS is a deliberate choice for a new package in 2026: dual publishing adds packaging complexity and dual-package hazards for little benefit.
