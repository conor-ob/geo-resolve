# geo-resolve

Resolve loose ISO 3166 references (codes, names, aliases) to the place they denote.

```ts
import { resolve, toAlpha3 } from "geo-resolve";

resolve("Holland")?.id; // => "NL"
toAlpha3("Germany"); // => "DEU"
```

geo-resolve takes a code from any supported scheme, an English name or an alias, and returns the full Entity it denotes: a Country, a Subdivision, a Historic country or a Territory. From that Entity you can read any other code or name. When an Input could mean more than one Entity, geo-resolve doesn't guess. It returns `null` and lets you narrow the search.

- **Exact, not fuzzy.** Inputs match after ignoring case, surrounding whitespace and diacritics (`" aland islands"` is Åland Islands), but never by spelling distance.
- **No hidden tie-breaks.** An ambiguous Input resolves to `null`, and `resolveAll` returns every Candidate.
- **Pay for what you load.** The default entry covers Countries and Territories. Subdivisions and Historic countries are separate Data packs.
- **ESM only, no runtime dependencies.** It runs in Node 22 and later, browsers, Deno, Bun and edge workers.

## Install

```bash
npm install geo-resolve
```

## Resolving an Input

The default entry resolves Countries and Territories by their codes, English Names and Aliases:

```ts
import { resolve, resolveAll, toAlpha2, toAlpha3, toName, toNumeric } from "geo-resolve";

resolve("DEU");
// => { kind: "country", id: "DE", alpha2: "DE", alpha3: "DEU", numeric: "276",
//   name: "Germany", codes: { ioc: "GER", fifa: "GER" } }

toAlpha2("Germany"); // => "DE"
toAlpha3("de"); // => "DEU"
toNumeric("DEU"); // => "276"
toName("276"); // => "Germany"
resolve("Atlantis"); // => null
resolveAll("Atlantis"); // => []
```

- `resolve(input, options?)` returns the single Entity the Input denotes, or `null` when there is none or the Input is ambiguous.
- `resolveAll(input, options?)` returns every Candidate, ordered by Kind then `id`, so you can tell "not found" (`[]`) from "ambiguous" (more than one).
- `toAlpha2`, `toAlpha3`, `toNumeric`, `toSubdivisionCode` and `toName` resolve the Input and return one field, or `null` when it doesn't resolve or the Entity has no such code.

The `to*` helpers are named for what they return, not for what they accept: `toAlpha2` takes any Input.

Every Entity is a frozen plain object with a `kind` field (`"country"`, `"subdivision"`, `"historic-country"` or `"territory"`) and an `id` that is unique across all Kinds: the Alpha-2 code for a Country, the Subdivision code for a Subdivision, the Alpha-4 code for a Historic country, and the user-assigned code for a Territory. New Kinds may be added in a minor release, so a `switch` on `kind` needs a `default` case.

## Data packs and `createResolver`

About 5,000 Subdivisions are far too many to load by default, so data is opt-in. Import the Data packs you need and build a Resolver from them:

```ts
import { createResolver } from "geo-resolve";
import countries from "geo-resolve/data/countries";
import usSubdivisions from "geo-resolve/data/subdivisions/US";

const resolver = createResolver({ data: [countries, usSubdivisions] });

resolver.toSubdivisionCode("California"); // => "US-CA"
resolver.resolve("US-TX")?.name; // => "Texas"
```

A Resolver has the same functions as the default entry, and they work detached from it (`const { resolve } = resolver`). Each Resolver keeps its own index, built on first use, so building one never changes another.

| Import                                 | Contents                                                  |
| -------------------------------------- | --------------------------------------------------------- |
| `geo-resolve`                          | The functions, bound to Countries and Territories         |
| `geo-resolve/data/countries`           | Every Country (ISO 3166-1)                                |
| `geo-resolve/data/subdivisions`        | Every Subdivision (ISO 3166-2)                            |
| `geo-resolve/data/subdivisions/<CODE>` | One Country's Subdivisions, by Alpha-2 code, such as `US` |
| `geo-resolve/data/historic-countries`  | Every Historic country (ISO 3166-3)                       |
| `geo-resolve/data/territories`         | Every Territory, such as Kosovo                           |

The default entry is the same as `createResolver({ data: [countries, territories] })`. Names are English only for now.

## Ambiguity and narrowing

Loose Inputs are often ambiguous. "Georgia" is a Country and a US Subdivision, and geo-resolve never picks one for you. If more than one Candidate remains, `resolve` returns `null`. You narrow the search with three options:

- `kinds` only considers Entities of these Kinds.
- `within` only considers the Entity with this `id` and those under it at any depth. It also lets a bare Subdivision code suffix match (`"CA"` within `"US"`).
- `from` only matches codes in these Schemes, for when you know which scheme your data uses. Names and Aliases never match under `from`.

With Countries, Subdivisions and Historic countries loaded:

```ts
import { createResolver } from "geo-resolve";
import countries from "geo-resolve/data/countries";
import historicCountries from "geo-resolve/data/historic-countries";
import subdivisions from "geo-resolve/data/subdivisions";

const { resolve, resolveAll } = createResolver({
  data: [countries, subdivisions, historicCountries],
});

resolve("Georgia"); // => null: the Country GE and the Subdivision US-GA
resolveAll("Georgia").map((entity) => entity.id); // => ["GE", "US-GA"]
resolve("Georgia", { kinds: ["country"] })?.id; // => "GE"
resolve("Georgia", { kinds: ["subdivision"] })?.id; // => "US-GA"
resolve("Georgia", { within: "US" })?.id; // => "US-GA"

resolve("Limburg", { kinds: ["subdivision"] }); // => null: BE-VLI and NL-LI
resolve("Limburg", { within: "NL" })?.id; // => "NL-LI"

resolve("CA")?.id; // => "CA": Subdivision codes only match in full ("US-CA")
resolve("CA", { within: "US" })?.id; // => "US-CA"

resolve("CS"); // => null: the Historic countries CSHH and CSXX
resolve("CSXX")?.name; // => "Serbia and Montenegro"
```

`within` takes an Entity `id` only (an Alpha-2 code such as `"US"` or a Subdivision code such as `"ES-AN"`), never a Name. Its job is to remove ambiguity, so its own value must be unambiguous. If you hold a loose value, resolve it first and pass its `id`. An `id` that doesn't exist matches nothing, so `resolve` returns `null` rather than throwing.

Which Data packs you load decides what counts as ambiguous. The default entry has no Subdivisions, so there "Georgia" is the Country:

```ts
import { resolve } from "geo-resolve";

resolve("Georgia")?.id; // => "GE"
```

If you want a preference rather than a filter, say so in code: `resolve(input, { kinds: ["country"] }) ?? resolve(input, { kinds: ["subdivision"] })`.

### Puerto Rico: one place, two Entities

ISO lists some places twice: Puerto Rico is the Country PR in ISO 3166-1 and the Subdivision US-PR in ISO 3166-2. geo-resolve keeps both as separate Entities, each with its own codes and Parent, joined by a Same-as link in `sameAs`. With both packs loaded, "Puerto Rico" is ambiguous like any other Input:

```ts
import { createResolver } from "geo-resolve";
import countries from "geo-resolve/data/countries";
import subdivisions from "geo-resolve/data/subdivisions";

const { resolve, resolveAll } = createResolver({ data: [countries, subdivisions] });

resolve("Puerto Rico"); // => null
resolveAll("Puerto Rico").map((entity) => entity.id); // => ["PR", "US-PR"]
resolve("Puerto Rico", { kinds: ["country"] })?.id; // => "PR"
resolve("Puerto Rico", { within: "US" })?.id; // => "US-PR"
resolve("US-PR");
// => { kind: "subdivision", id: "US-PR", code: "US-PR", country: "US", parent: "US",
//      name: "Puerto Rico", sameAs: ["PR"] }
```

## Historic countries and Successors

A Historic country is a former ISO 3166-1 entry that ISO has withdrawn and recorded in ISO 3166-3. Its `id` is its Alpha-4 code, because ISO sometimes reassigns a withdrawn Alpha-2 code: `CS` was Czechoslovakia, then Serbia and Montenegro.

```ts
import { createResolver } from "geo-resolve";
import countries from "geo-resolve/data/countries";
import historicCountries from "geo-resolve/data/historic-countries";

const { resolve } = createResolver({ data: [countries, historicCountries] });

resolve("YUG");
// => { kind: "historic-country", id: "YUCS", alpha4: "YUCS", alpha2: "YU", alpha3: "YUG",
//   numeric: "891", name: "Yugoslavia", withdrawn: "2003-07-23", successors: ["CSXX"] }

const serbiaAndMontenegro = resolve("Serbia and Montenegro");
if (serbiaAndMontenegro?.kind === "historic-country") {
  serbiaAndMontenegro.successors; // => ["ME", "RS"]
}

resolve("ROM")?.id; // => "RO": a former code of a Country that still exists
```

- `successors` lists the `id`s of the Entities ISO names as replacing it. They are ISO's direct replacements, not political successor states, and a Successor can itself be a Historic country (Yugoslavia → Serbia and Montenegro → Montenegro and Serbia). geo-resolve never maps a Historic country to a Successor for you, because a withdrawal is often one-to-many: the Soviet Union has 13.
- `withdrawn` is the date ISO withdrew the code, as an ISO 8601 string only as precise as ISO published it (`"1992"`, `"2003-07-23"`). It isn't the date the state dissolved.
- Former codes of Countries that still exist resolve to the current Country: `ROM` is Romania, which became `ROU` in 2002. They need no extra Data pack.

## Territories and Kosovo

A Territory is a country-level unit that ISO 3166 doesn't list as a Country, but that Unicode CLDR lists as a region and at least two of the shipped Code systems treat as a peer of Countries. Today that admits Kosovo only. ISO 3166-1 gives it no code, but the IOC and FIFA code it KOS, and CLDR uses the user-assigned code XK.

```ts
import { resolve, toAlpha2 } from "geo-resolve";

resolve("KOS");
// => { kind: "territory", id: "XK", name: "Kosovo", codes: { ioc: "KOS", fifa: "KOS" } }

resolve("XK")?.name; // => "Kosovo"
toAlpha2("Kosovo"); // => null: a Territory has no ISO codes
resolve("Kosovo", { kinds: ["country"] }); // => null: a Territory isn't a Country
resolve("Kosovo", { kinds: ["country", "territory"] })?.id; // => "XK"
```

A Territory has no ISO codes, no Parent and no Subdivisions. XK is a code ISO reserves for user assignment and never assigns itself, so it sits in `id` rather than `alpha2`. ISO 3166-2 still lists Kosovo as part of Serbia, so once Serbia's Subdivisions are loaded "Kosovo" is ambiguous between XK and the Subdivision RS-25.

## Code systems

Besides the ISO codes, Entities carry codes from non-ISO Code systems in `codes`: today the IOC's and FIFA's. They match by default, just like ISO codes.

### FIFA's home nations

FIFA codes England, Scotland, Wales and Northern Ireland separately. ISO has no Countries for them, only the Subdivisions GB-ENG, GB-SCT, GB-WLS and GB-NIR, so that is where their FIFA codes sit. GB itself has no FIFA code. Load the GB Subdivisions to resolve them:

```ts
import { createResolver, resolve } from "geo-resolve";
import countries from "geo-resolve/data/countries";
import gbSubdivisions from "geo-resolve/data/subdivisions/GB";

const resolver = createResolver({ data: [countries, gbSubdivisions] });

resolver.resolve("ENG")?.id; // => "GB-ENG"
resolver.toSubdivisionCode("SCO"); // => "GB-SCT"
resolver.resolve("WAL")?.name; // => "Wales"
resolver.resolve("NIR");
// => { kind: "subdivision", id: "GB-NIR", code: "GB-NIR", country: "GB", parent: "GB",
//      name: "Northern Ireland", codes: { fifa: "NIR" } }
resolve("ENG"); // => null: the default entry has no Subdivisions
```

### When two Schemes share a code: BRN

`BRN` is Brunei's Alpha-3 code and Bahrain's IOC code. geo-resolve doesn't rank ISO codes above Code systems, so `BRN` is ambiguous until you say which Scheme you mean with `from`:

```ts
import { resolve, resolveAll, toName } from "geo-resolve";

resolve("BRN"); // => null
resolveAll("BRN").map((entity) => entity.id); // => ["BH", "BN"]
toName("BRN", { from: ["alpha3"] }); // => "Brunei"
toName("BRN", { from: ["ioc"] }); // => "Bahrain"
resolve("Bahrain", { from: ["ioc"] }); // => null: Names belong to no Scheme
```

The Schemes are `alpha2`, `alpha3`, `numeric`, `subdivision-code`, `alpha4`, `ioc` and `fifa`. A former code counts under the Scheme that issued it, so `ROM` is `alpha3`. An unknown Scheme, or an empty list, matches nothing.

## Stability and versioning

geo-resolve is meant to be depended on for years while ISO 3166 changes several times a year, so the API is designed for data changes not to break your code:

- **Codes are typed as `string`**, not as a union of today's codes, so a withdrawn code never stops your code type-checking. `KnownAlpha2`, `KnownAlpha3` and `KnownSubdivisionCode` are exported as optional helpers, but aren't covered by semver.
- **`kind`, Schemes and the `codes` keys are open unions** that may grow in a minor release. Handle values you don't know.
- **Every function takes a single options object** after its Input, so new options are never breaking.
- **Entities are read-only.** Adding a field is a minor release; removing or renaming one is a major release.
- **Only the documented imports above are importable.** Everything else is internal.

Data changes are versioned like this:

- **Patch**: corrections to Names or Aliases.
- **Minor**: new or changed codes, and Countries that ISO withdraws (they still resolve, now as Historic countries). A minor release can therefore change what an Input resolves to.
- **Major**: changes to the API or to the shape of Entities.

Because geo-resolve never breaks a tie for you, data added in a release can turn a result into `null` (now ambiguous), but never into a different Entity. Each data release's changelog lists the ISO 3166 changes it includes.

## API reference

Every export is documented with TSDoc, so your editor shows the reference as you type. To build the HTML reference with TypeDoc from a clone of the repository, run `vp run @geo-resolve/docs#build`.

## Data and licensing

geo-resolve is MIT licensed. Its data is built only from two Sources, both under permissive licences:

- [Unicode CLDR](https://cldr.unicode.org), under the [Unicode License v3](https://www.unicode.org/license.txt), is the primary Source for Country and Subdivision codes, English Names and the Parent hierarchy.
- [Wikidata](https://www.wikidata.org), under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/), supplies IOC and FIFA codes and Aliases.

Historic countries and the former codes of current Countries are curated by hand from ISO's public pages and change notices. ISO's own dataset is a paid product and isn't used. The package's `NOTICE.md` gives the attribution, and is included in every release.

The codes are checked in CI against Debian's `iso-codes`, but none of its data is shipped.
