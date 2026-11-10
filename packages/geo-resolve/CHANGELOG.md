# geo-resolve

## 0.1.2

### Patch Changes

- 191bbe5: Update the data from the latest CLDR and Wikidata Snapshots: add "Birmania" as an Alias of Myanmar, and store Ukraine's "Ukraina" Alias as "Ukraïna", following Wikidata. Inputs match regardless of diacritics, so "Ukraina" still resolves to Ukraine.

## 0.1.1

### Patch Changes

- 0040166: Add npm keywords and a plainer description so the package is easier to find.

## 0.1.0

### Minor Changes

- 13f3de9: The first release. Resolves ISO 3166 codes, English Names and Aliases to Countries, Subdivisions, Historic countries and Territories, with `kinds`, `within` and `from` to narrow ambiguous Inputs. Data from Unicode CLDR and Wikidata.
