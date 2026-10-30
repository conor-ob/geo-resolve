# API stability contract

geo-resolve is meant to be depended on for years, and ISO changes several times a year, so the API is designed so that data changes and additive features never break consumers. Every other decision should be checked against these rules:

- **Public signatures use `string` for codes**, not literal unions derived from the data. A withdrawn code would otherwise stop type-checking in users' code on a data update. Literal unions (`KnownAlpha2`, `KnownAlpha3`, `KnownSubdivisionCode`) are exported as optional helpers and are explicitly not covered by semver.
- **Enum-like fields are open unions that may grow in a minor release**: `kind`, Subdivision type and the `codes` keys are typed as `Known… | (string & {})`. Consumers must handle a `default` case.
- **Every function takes a single options object** after its required argument. No positional booleans or optional positional parameters, so new options are never breaking.
- **Entities are read-only.** Adding a field is minor; removing or renaming one is major.
- **Only documented subpaths are importable**, enforced by the `exports` map. Generated indexes and internal modules are never reachable.

This is enforced in CI: API Extractor's report (`geo-resolve.api.md`) is committed so every change to the public surface appears as a reviewable diff, and `@arethetypeswrong/cli` and `publint` check the package before publishing.
