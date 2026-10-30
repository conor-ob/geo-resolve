# geo-resolve

geo-resolve turns a loose reference to a place (a code, a name, an alias, in any supported language) into the full geographic entity it denotes, so callers can read any other code or name from it.

## Entities

**Entity**:
A geographic unit defined by the ISO 3166 family of standards: a Country, a Subdivision, or a Historic country.
_Avoid_: place, location, area, region (reserved for a future UN M49 kind)

**Kind**:
Which of the entity categories an Entity belongs to: country, subdivision or historic-country.
_Avoid_: typename, entity type, category

**Country**:
A currently assigned ISO 3166-1 entry. Includes dependent territories such as Puerto Rico or Åland, which ISO lists as countries.
_Avoid_: nation, state, sovereign state

**Subdivision**:
A currently assigned ISO 3166-2 entry: a principal administrative division of a Country, such as a state, province, county or home nation.
_Avoid_: region, province, admin area, state (these are Subdivision types, not the general term)

**Subdivision type**:
The category ISO assigns a Subdivision within its Country, such as state, autonomous community or council area, kept as ISO names it rather than mapped to a smaller shared set.
_Avoid_: level, admin level

**Parent**:
The Entity a Subdivision sits directly under: its Country, or another Subdivision where ISO nests them (Spanish provinces under autonomous communities).
_Avoid_: owner, container

**Historic country**:
A former ISO 3166-1 entry that has been withdrawn and recorded in ISO 3166-3, such as Yugoslavia or the Soviet Union.
_Avoid_: former country, deprecated country, dead country

**Successor**:
A Country that took over all or part of a Historic country's territory when its code was withdrawn. A Historic country can have several.
_Avoid_: replacement, new code

**Same-as link**:
A connection between two Entities that ISO lists separately but that denote the same territory, such as the Country PR and the Subdivision US-PR. Both remain distinct Entities.
_Avoid_: duplicate, alias (an Alias is a name, not an Entity)

## Codes and names

**Alpha-2 code**:
The two-letter ISO 3166-1 code of a Country, such as DE.
_Avoid_: iso2, ISO code (ambiguous)

**Alpha-3 code**:
The three-letter ISO 3166-1 code of a Country, such as DEU.
_Avoid_: iso3

**Numeric code**:
The three-digit ISO 3166-1 code of a Country, shared with UN M49, such as 276.

**Subdivision code**:
The ISO 3166-2 code of a Subdivision: its Country's Alpha-2 code, a hyphen and a suffix of up to three characters, such as US-CA or GB-ENG.
_Avoid_: iso3 (the suffix is not an Alpha-3 code), region code

**Alpha-4 code**:
The four-letter ISO 3166-3 code that uniquely identifies a Historic country, such as YUCS, needed because withdrawn Alpha-2 codes are sometimes reassigned.

**Code system**:
A non-ISO scheme that also assigns codes to Entities, such as IOC or FIFA codes.
_Avoid_: standard (ISO 3166 is the standard)

**Name**:
The label of an Entity in a given Locale. Every Entity has an English name.

**Alias**:
An additional label that should resolve to an Entity but is not its Name, such as Holland for the Netherlands.
_Avoid_: nickname, synonym

**Locale**:
A language (and optionally script or region) for which Names, Aliases and Subdivision type labels are available, identified by a CLDR locale identifier such as de or pt-BR.
_Avoid_: language (when the variant matters)

## Resolution

**Input**:
Any loose reference to an Entity: a code from any supported scheme, a Name or an Alias, in any loaded Locale.
_Avoid_: query, search term

**Resolve**:
To find the single Entity that an Input denotes, or to report that there is none or that the Input is ambiguous.
_Avoid_: look up, search, match, parse

**Candidate**:
One Entity that an Input could denote, when it could denote several.
_Avoid_: result, hit

**Ambiguous input**:
An Input that still has more than one Candidate after the caller's stated preferences are applied, such as Georgia (a Country and a US Subdivision) with no preference given.

**Preference**:
The caller's statement of which Kinds or which Country an Input should resolve within, used to narrow Candidates. geo-resolve never narrows Candidates without one.
_Avoid_: priority, precedence, default ranking

**Resolver**:
A configured view over a chosen set of Entities and Locales, against which Inputs are resolved.
_Avoid_: client, instance, database

## Data

**Source**:
An upstream dataset that Entities, codes, Names or Aliases are built from: Unicode CLDR or Wikidata.
_Avoid_: provider, feed

**Snapshot**:
A fixed copy of a Source kept in the repository, from which a release is built.
_Avoid_: cache, dump

**Overlay**:
A small hand-maintained set of additions and corrections applied on top of the Sources, such as extra Aliases.
_Avoid_: patch, overrides

**Data pack**:
A separately importable bundle of Entities, such as all Subdivisions or one Country's Subdivisions.

**Locale pack**:
A separately importable bundle of Names, Aliases and Subdivision type labels for one Locale.
_Avoid_: translation file, i18n bundle
