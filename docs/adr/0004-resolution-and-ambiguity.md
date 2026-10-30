# Resolution and ambiguity

Loose Inputs are often ambiguous ("Georgia", "CA", "Limburg"), and surfacing that is the main thing geo-resolve does better than a lookup table. The API is entity-first:

- `resolve(input, options)` returns one Entity, or `null` when there is no Candidate or the Input is ambiguous.
- `resolveAll(input, options)` returns every Candidate, best first.
- `to*` helpers (`toAlpha2`, `toAlpha3`, `toNumeric`, `toSubdivisionCode`, `toName`) resolve any Input and return one field. They are named for what they return; strict parsing of one code scheme is an option (`from: "alpha2"`) rather than a family of `resolveAlpha2`-style functions, whose name would be ambiguous between "parse as" and "convert to".

When an Input has Candidates of different Kinds, `resolve` ranks them in a fixed order: Country, then Subdivision, then Historic country. Among Historic countries the most recently withdrawn wins (`CS` → Serbia and Montenegro). Any other tie between Candidates of the same Kind (two Subdivisions called Limburg) makes the Input ambiguous and `resolve` returns `null`. Callers narrow the search with options such as `within: "US"` (which makes `CA` California) and `kinds: ["subdivision"]`.
