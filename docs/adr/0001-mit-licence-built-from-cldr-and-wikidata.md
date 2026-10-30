# MIT licence, built from CLDR and Wikidata

geo-resolve is published under MIT and its data is built only from Unicode CLDR (Unicode-3.0 licence) and Wikidata (CC0). ISO's own machine-readable dataset is a paid licensed product, and the de facto open mirror, Debian `iso-codes`, is LGPL-2.1. Bundling LGPL data would pass LGPL obligations to every downstream user, which deters many companies, so `iso-codes` is used only as a test-time oracle: CI compares our generated codes against it and flags differences for review, but none of its data is copied or shipped.

The two Sources have different roles. A coverage check against `iso-codes` (October 2026) found:

| | CLDR | Wikidata |
|---|---|---|
| Subdivision codes | 99.6% | 98.0%, plus 279 stale codes and 91 codes on more than one item |
| English Subdivision names | 100% | not checked |
| German Subdivision names | 97.1% | not checked |
| Parent hierarchy | 99.96% | 91% agree, 296 missing, 144 conflicting |
| Subdivision type | none | only loose class labels (Tokyo is a "big city") |

So **CLDR is the primary Source** for Country and Subdivision codes, Names and the Parent hierarchy. **Wikidata supplies** non-ISO Code systems (IOC, FIFA), Aliases, and Names that CLDR lacks. Wikidata is too noisy to be trusted for codes or Parents. CLDR lags ISO in places (it still placed FR-67 and FR-68 under Grand Est after ISO moved them to the European Collectivity of Alsace), which is what the `iso-codes` check catches; fixes go in the Overlay. No permissive Source carries Subdivision type, which is why it is deferred (ADR-0003).

## Considered Options

- **Bundle Debian `iso-codes`**: the most direct mirror of ISO, but LGPL-2.1.
- **License ISO's dataset**: authoritative, but paid and not redistributable.
- **CLDR + Wikidata (chosen)**: permissive, covers codes, hierarchy, names in 100+ languages and non-ISO code systems.

## Consequences

Contributors must not copy data from `iso-codes` (or any other non-permissive source) into the repository, the Overlay included. Every new Source needs a licence check before it is added.
