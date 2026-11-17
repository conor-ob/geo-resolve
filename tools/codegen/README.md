# @geo-resolve/codegen

Builds the Data packs in `packages/geo-resolve/src/data` from committed Snapshots plus the Overlay (ADR-0008). Private: never published.

## Pipeline

`build` (`src/build.ts`) runs, with no network access:

1. Reads the CLDR Snapshots under `sources/cldr` and builds Countries, Subdivisions and their Parents.
2. Reads `overlay.json` (`src/overlay.ts`): Historic countries, Same-as links, Parent and code corrections, Territories, Alias edits.
3. Joins Wikidata (`src/wikidata.ts`): picks each Country's item, joins IOC and FIFA codes, and collects its labels as Alias candidates.
4. Applies the Alias rules (`src/alias-rules.ts`, ADR-0013) to Wikidata's labels, CLDR's variant and short names (ADR-0014) and the Overlay's additions and removals.
5. Writes the Data packs and `build-report.md`, or throws once with every problem found.

`fetch-snapshots` (`src/fetch.ts`) refreshes `sources/`; `alias-changes` and `compare-iso-codes` are checks the data-update and CI workflows run.

## Tests

- **A rule about which Aliases ship:** call `applyAliasRules` with plain Entities and candidates (`tests/alias-rules.test.ts`).
- **Reading a Snapshot, joining Wikidata, or what `build` writes:** `buildWith` writes fixture Snapshots and an Overlay to a temp dir and runs `build` (`tests/fixtures.ts`, `tests/wikidata.test.ts`).
