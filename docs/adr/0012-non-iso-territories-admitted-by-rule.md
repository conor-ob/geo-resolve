# Non-ISO Territories, admitted by rule

geo-resolve's Entities are the ISO 3166 entries plus a small set of **Territories**: country-level units that ISO doesn't list but that Code systems do. This narrows the "scope is ISO 3166" rule in ADR-0002. Without it, the library can't resolve the most common non-ISO lookup. Kosovo has IOC and FIFA code KOS, E.164 calling code +383 and UN M49 code 412, but only the user-assigned code XK in ISO 3166.

A unit is admitted as a Territory only when all three hold:

- ISO 3166 has no entry for it at any level, Country or Subdivision.
- At least two of the Code systems geo-resolve ships code it as a peer of Countries.
- It is a territory, not a team, a service or a grouping of other Entities.

Today this admits Kosovo only. Units that ISO lists as Subdivisions are not Territories; their codes attach to the Subdivision. For example, FIFA's ENG, SCO, WAL and NIR attach to GB-ENG, GB-SCT, GB-WLS and GB-NIR, and `.ac` and +247 attach to SH-AC. Units coded by only one system are not admitted, such as Alderney (vehicle sign GBA) and Gaza and the West Bank (GENC). Neither are units with no territory, such as the IOC's refugee and neutral-athlete teams (EOR, AIN) or the E.164 global service codes. Neither are codes that cover several Entities, such as +1, +7 and the World Bank's Channel Islands code: such a code points at each Entity it covers. When a Code system uses a political name for an ISO Entity ("Chinese Taipei" for TW, "Great Britain" for GB), that name is an Alias of the ISO Entity.

A Territory's `id` is the code permissive Sources already use for it: XK for Kosovo, which CLDR lists as a region and FIFA's own data also uses. ISO reserves the X-prefixed codes for user assignment and never assigns them itself, so XK can't collide with a future ISO code. A unit with no such code is not admitted. A Territory has `kind`, `id`, `name`, `codes` and optional `sameAs`. It has no ISO-named fields, so `toAlpha2("Kosovo")` returns `null`. It has no Parent and no Subdivisions, so `within: "XK"` matches only Kosovo itself.

## Considered Options

- **Not modelled (`resolve("KOS")` returns `null`)**: rejected. It fails the non-ISO lookup developers hit most.
- **Kosovo as a one-off exception**: rejected. It leaves no rule for the next case.
- **Kosovo as a Country with an `iso: false` flag**: rejected. Filtering by `kinds: ["country"]` would keep working, but XK would sit under `alpha2` and be written into databases as if ISO had assigned it.
- **The home nations as their own Entities**: rejected. They are the same territory as the ISO Subdivisions and would only need Same-as links back to them.

## Consequences

The admitted set depends on which Code systems ship: adding or dropping one re-runs the rule, and dropping IOC or FIFA could remove Kosovo. `kinds: ["country"]` excludes Territories, so callers who want every country-level unit must ask for `kinds: ["country", "territory"]`. Code-system codes can sit on any Kind, including Subdivisions. What happens to a Territory's `id` and Kind if ISO later assigns it an official code has not been decided.
