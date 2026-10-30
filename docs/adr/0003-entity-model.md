# Entity model

Entities are frozen plain objects discriminated by a `kind` field (`country | subdivision | historic-country`), not classes and not a GraphQL-style `__typename`, which would leak a transport convention into the public API. Every Entity has an `id`: the Alpha-2 code for a Country, the Subdivision code for a Subdivision, and the Alpha-4 code for a Historic country. Alpha-4 is needed because ISO reassigns withdrawn Alpha-2 codes (`CS` was Czechoslovakia, then Serbia and Montenegro).

Non-obvious choices:

- **Subdivisions have no `type` field yet.** Subdivision type would be descriptive only ("Limburg, province of the Netherlands"); narrowing is done by `kinds` and `within`, and address-form labels ("State" or "Province" for a form field) are out of scope. No permissive Source carries it (ADR-0001), so rather than ship a half-sourced field, it is deferred; adding a field is a minor release (ADR-0006). When it is added, two decisions remain open: the Source, and whether values use ISO's own category names or a vocabulary of our own. The likely Source is a hand-maintained table mapping each Country's Wikidata classes to types. Across 368 (Country, ISO type) pairs, 288 have a Wikidata class that matches exactly; the remaining 79 need curating by hand. That table must be built from Wikidata, ISO's public browsing platform or national sources, never from `iso-codes`.
- **Subdivisions have a Parent** that may be another Subdivision, because ISO nests some (Spanish provinces under autonomous communities).
- **Historic countries list their Successors and are never auto-mapped to one**, because withdrawals are often one-to-many (Yugoslavia → RS, ME, …).
- **Entities that ISO lists twice stay separate, joined by a Same-as link** (`PR` ↔ `US-PR`), rather than being merged, so each keeps its own codes and Parent.
- **Non-ISO codes live under `codes`** (`codes.ioc`, `codes.fifa`) and are named for their actual Code system, never stored under an ISO field name: a Subdivision code suffix is not an Alpha-3 code, and a FIFA code is not an IOC code.
