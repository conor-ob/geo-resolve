# Resolution and ambiguity

Loose Inputs are often ambiguous, and surfacing that is the main thing geo-resolve does better than a lookup table. The API is entity-first:

- `resolve(input, options)` returns one Entity, or `null` when there is no Candidate or the Input is ambiguous.
- `resolveAll(input, options)` returns every Candidate, in a deterministic order, so callers can tell "not found" from "ambiguous" and choose for themselves.
- `to*` helpers (`toAlpha2`, `toAlpha3`, `toNumeric`, `toSubdivisionCode`, `toName`) resolve any Input and return one field. They are named for what they return; strict parsing of one code scheme is an option (`from: "alpha2"`) rather than a family of `resolveAlpha2`-style functions, whose name would be ambiguous between "parse as" and "convert to".

**There are no hidden tie-break rules.** If more than one Candidate remains after applying the caller's options, the Input is ambiguous and `resolve` returns `null`. The caller states intent through options:

- `kinds` filters which Kinds are considered at all.
- `prefer` orders Kinds; when Candidates of several Kinds remain, the first preferred Kind with Candidates is kept.
- `within` limits Subdivisions to one Country (or Parent), and lets a bare Subdivision code suffix match.

```ts
resolve("Georgia");                             // null: Country GE and Subdivision US-GA
resolve("Georgia", { prefer: ["country"] });    // Country GE
resolve("Georgia", { kinds: ["subdivision"] }); // Subdivision US-GA
resolve("Limburg", { kinds: ["subdivision"] }); // null: BE-VLI and NL-LI
resolve("Limburg", { within: "NL" });           // Subdivision NL-LI
resolve("CA");                                  // Country CA: Subdivision codes only match in full (US-CA)
resolve("CA", { within: "US" });                // Subdivision US-CA
resolve("CS");                                  // null: Historic countries CSHH and CSXX
resolve("CSXX");                                // Historic country Serbia and Montenegro
```

`prefer` only breaks ties between Kinds. A tie within one Kind is always ambiguous and is narrowed with `within` or a more specific code, because any built-in rule (most populous, most recent) would be a guess the caller can't see.

## Considered Options

- **Fixed precedence by default (Country, then Subdivision, then Historic country; most recently withdrawn wins)**: rejected. It silently answers a question the caller never asked. A mistaken `resolve("Georgia")` returns a confident wrong answer rather than `null`, and the result can change when a release adds an Entity or Name that outranks the old one.
- **Explicit intent through options (chosen)**: every non-null result is one the caller's options made unique. Adding an Entity or Locale can turn a result into `null` (now ambiguous), but never into a different Entity, which suits the data semver policy (ADR-0007).
