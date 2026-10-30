# Resolution and ambiguity

Loose Inputs are often ambiguous, and surfacing that is the main thing geo-resolve does better than a lookup table. The API is entity-first:

- `resolve(input, options)` returns one Entity, or `null` when there is no Candidate or the Input is ambiguous.
- `resolveAll(input, options)` returns every Candidate, in a deterministic order, so callers can tell "not found" from "ambiguous" and choose for themselves.
- `to*` helpers (`toAlpha2`, `toAlpha3`, `toNumeric`, `toSubdivisionCode`, `toName`) resolve any Input and return one field. They are named for what they return, not for what they accept: a `resolveAlpha2`-style name would be ambiguous between "parse as" and "convert to".

**There are no hidden tie-break rules.** If more than one Candidate remains after applying the caller's options, the Input is ambiguous and `resolve` returns `null`. The caller narrows the search with three options:

- `kinds` limits which Kinds are considered.
- `within` limits Candidates to Entities under one Country or Subdivision, and lets a bare Subdivision code suffix match.
- `locale` limits Name and Alias matching to one Locale. By default, Names match in every Locale loaded into the Resolver (see ADR-0009).

```ts
resolve("Georgia");                             // null: Country GE and Subdivision US-GA
resolve("Georgia", { kinds: ["country"] });     // Country GE
resolve("Georgia", { kinds: ["subdivision"] }); // Subdivision US-GA
resolve("Limburg", { kinds: ["subdivision"] }); // null: BE-VLI and NL-LI
resolve("Limburg", { within: "NL" });           // Subdivision NL-LI
resolve("CA");                                  // Country CA: Subdivision codes only match in full (US-CA)
resolve("CA", { within: "US" });                // Subdivision US-CA
resolve("CS");                                  // null: Historic countries CSHH and CSXX
resolve("CSXX");                                // Historic country Serbia and Montenegro
```

`within` takes an Entity `id` only: an Alpha-2 code (`"US"`) or a Subdivision code (`"ES-AN"`), never an Alpha-3 code, Numeric code or Name. It exists to remove ambiguity, so its own value must be unambiguous, which an `id` always is; accepting a loose Input would make `within: "Georgia"` ambiguous in turn. Callers holding a loose value resolve it first and pass `.id`. `within` keeps only Entities under the given one at any depth (`within: "ES"` finds provinces nested under autonomous communities) and so drops every other Country (`resolve("Georgia", { within: "US" })` is US-GA). Bare Subdivision code suffixes match relative to the Country (`"CA"` within `"US"` is US-CA). An `id` that doesn't exist, or that has been withdrawn, matches nothing and `resolve` returns `null` rather than throwing, so a data release that withdraws a code can't make callers' code start throwing (ADR-0007).

Every non-null result is one the caller's options made unique. Adding an Entity or Locale in a release can turn a result into `null` (now ambiguous), but never into a different Entity, which suits the data semver policy (ADR-0007).

## Considered Options

- **Fixed precedence by default (Country, then Subdivision, then Historic country; most recently withdrawn wins)**: rejected. It silently answers a question the caller never asked. A mistaken `resolve("Georgia")` returns a confident wrong answer rather than `null`, and the result can change when a release adds an Entity or Name that outranks the old one.
- **A `prefer` option ranking Kinds** (`prefer: ["country"]` resolves "Georgia" as GE but still resolves "Texas" as US-TX): deferred. It overlaps with `kinds` in a way every user would have to learn, it breaks the guarantee above (a newly added preferred-Kind Entity can change a result to a different Entity), and callers can already express it with `resolve(x, { kinds: ["country"] }) ?? resolve(x, { kinds: ["subdivision"] })`.
- **A `from` option for strict parsing** (`from: "alpha2"` rejects anything that isn't an Alpha-2 code): deferred. It serves validation, which callers can do by checking the Input's shape before resolving.

- **`within` accepting an Entity object or several ids** (`within: us`, `within: ["GB", "IE"]`): deferred for the same reason.

All deferred options can be added in a minor release if real usage shows a need (ADR-0006), whereas removing an option is a major release. That asymmetry is why options are added only on demonstrated need.
