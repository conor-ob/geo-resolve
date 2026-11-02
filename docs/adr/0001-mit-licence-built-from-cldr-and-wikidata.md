# MIT licence, built from CLDR and Wikidata

geo-resolve is published under MIT and its data is built only from Unicode CLDR (Unicode-3.0 licence) and Wikidata (CC0). ISO's own machine-readable dataset is a paid licensed product, and the de facto open mirror, Debian `iso-codes`, is LGPL-2.1. Bundling LGPL data would pass LGPL obligations to every downstream user, which deters many companies, so `iso-codes` is used only as a test-time oracle: CI compares our generated codes against it and flags differences for review, but none of its data is copied or shipped.

The two Sources have different roles. A coverage check against `iso-codes` (October 2026) found:

|                           | CLDR   | Wikidata                                                       |
| ------------------------- | ------ | -------------------------------------------------------------- |
| Subdivision codes         | 99.6%  | 98.0%, plus 279 stale codes and 91 codes on more than one item |
| English Subdivision names | 100%   | not checked                                                    |
| German Subdivision names  | 97.1%  | not checked                                                    |
| Parent hierarchy          | 99.96% | 91% agree, 296 missing, 144 conflicting                        |
| Subdivision type          | none   | only loose class labels (Tokyo is a "big city")                |

So **CLDR is the primary Source** for Country and Subdivision codes, Names and the Parent hierarchy. **Wikidata supplies** non-ISO Code systems (IOC, FIFA), Aliases, and Names that CLDR lacks. Wikidata is too noisy to be trusted for codes or Parents. CLDR lags ISO in places (it still placed FR-67 and FR-68 under Grand Est after ISO moved them to the European Collectivity of Alsace), which is what the `iso-codes` check catches; fixes go in the Overlay. No permissive Source carries Subdivision type, which is why it is deferred (ADR-0003).

**Historic countries are hand-curated in the Overlay.** A second check covered ISO 3166-3's 31 entries. CLDR has no alpha-4 codes or dates and keeps one mapping per former alpha-2 code (merging Czechoslovakia and Serbia and Montenegro under `CS`). Wikidata has all 31 alpha-4 codes but describes political states, not ISO code changes: its dissolution dates and successors differ from ISO's withdrawal dates and replacements, and it has the former alpha-2 code for only 3 of the 31. With so few records, each is curated from ISO's public browsing platform and change notices and cites the page or notice it came from, so a reviewer can verify it without opening `iso-codes`. Former codes of Countries that still exist (`ROM` for Romania) are curated the same way. Localised Names for Historic countries come from Wikidata labels, which are reliable for names even though Wikidata's dates and successors aren't used.

**IOC and FIFA codes come from Wikidata only.** Neither body publishes a reusable list: FIFA's terms of service forbid reuse of its data, and the IOC's code tables carry no reuse terms. The codes are short identifiers, which are facts rather than protectable expression, and Wikidata's CC0 compilation of them is independent of FIFA's and the IOC's own databases. So geo-resolve ships both, but never fetches FIFA's site or API (`api.fifa.com`), not even to check its codes. Disagreements are found by comparing against a public listing, without copying from it, and fixed in the Overlay.

## Considered Options

- **Bundle Debian `iso-codes`**: the most direct mirror of ISO, but LGPL-2.1.
- **License ISO's dataset**: authoritative, but paid and not redistributable.
- **CLDR + Wikidata (chosen)**: permissive, covers codes, hierarchy, names in 100+ languages and non-ISO code systems.

## Consequences

Contributors must not copy data from `iso-codes` (or any other non-permissive source) into the repository, the Overlay included. Every new Source needs a licence check before it is added.
