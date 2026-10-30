# Entity model

Entities are frozen plain objects discriminated by a `kind` field (`country | subdivision | historic-country`), not classes and not a GraphQL-style `__typename`, which would leak a transport convention into the public API. Every Entity has an `id`: the Alpha-2 code for a Country, the Subdivision code for a Subdivision, and the Alpha-4 code for a Historic country. Alpha-4 is needed because ISO reassigns withdrawn Alpha-2 codes (`CS` was Czechoslovakia, then Serbia and Montenegro).

Non-obvious choices:

- **Subdivision type is ISO's own category as a kebab-case slug** (`state`, `autonomous-community`, `council-area`), not a small normalised enum. ISO uses around 200 categories across Countries; mapping them onto `state | province | county` loses meaning and invites endless disputes. Display labels ("State", "Bundesland") come from Locale packs.
- **Subdivisions have a Parent** that may be another Subdivision, because ISO nests some (Spanish provinces under autonomous communities).
- **Historic countries list their Successors and are never auto-mapped to one**, because withdrawals are often one-to-many (Yugoslavia → RS, ME, …).
- **Entities that ISO lists twice stay separate, joined by a Same-as link** (`PR` ↔ `US-PR`), rather than being merged, so each keeps its own codes and Parent.
- **Non-ISO codes live under `codes`** (`codes.ioc`, `codes.fifa`) and are named for their actual Code system, never stored under an ISO field name: a Subdivision code suffix is not an Alpha-3 code, and a FIFA code is not an IOC code.
