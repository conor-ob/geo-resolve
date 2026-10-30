# Snapshot-based data pipeline

CLDR is versioned and can be pinned, but Wikidata is not, so builds would not be reproducible if they queried it live. Codegen is therefore split in two:

- `fetch` downloads a pinned CLDR release and runs the Wikidata queries, writing raw Snapshots to `sources/`, which are committed.
- `build` turns the Snapshots plus the Overlay into the generated Data packs and Locale packs, with no network access.

A scheduled GitHub Action runs `fetch` weekly and, when anything changed, opens a PR with a readable diff of Entities that were added, removed or renamed. Reviewing that PR is the update process, and the reason upstream changes are noticed rather than missed. The cost is a larger repository; that is accepted for reproducible releases.
