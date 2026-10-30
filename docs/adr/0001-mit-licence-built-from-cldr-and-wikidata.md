# MIT licence, built from CLDR and Wikidata

geo-resolve is published under MIT and its data is built only from Unicode CLDR (Unicode-3.0 licence) and Wikidata (CC0). ISO's own machine-readable dataset is a paid licensed product, and the de facto open mirror, Debian `iso-codes`, is LGPL-2.1. Bundling LGPL data would pass LGPL obligations to every downstream user, which deters many companies, so `iso-codes` is used only as a test-time oracle: CI compares our generated codes against it and flags differences for review, but none of its data is copied or shipped.

## Considered Options

- **Bundle Debian `iso-codes`**: the most direct mirror of ISO, but LGPL-2.1.
- **License ISO's dataset**: authoritative, but paid and not redistributable.
- **CLDR + Wikidata (chosen)**: permissive, covers codes, hierarchy, names in 100+ languages and non-ISO code systems.

## Consequences

Contributors must not copy data from `iso-codes` (or any other non-permissive source) into the repository, the Overlay included. Every new Source needs a licence check before it is added.
