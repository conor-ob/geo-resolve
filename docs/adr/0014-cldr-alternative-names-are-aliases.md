# CLDR's variant and short English names are Aliases

CLDR gives some regions alternative English names beside the default one it uses as their Name: `alt="variant"` forms such as "Swaziland" for SZ and "Czech Republic" for CZ, and `alt="short"` forms such as "Bosnia" for BA and "UK" for GB. They are Aliases of their Entity, with CLDR as their Source in the build report. Before this, the build discarded every alternative name, so a common name kept resolving only while Wikidata listed it. When Wikidata moved "Swaziland" from English to `mul`, nothing else held it.

Both forms are admitted. A short name is a name people use for the Entity just as a variant is ("Bosnia", "Palestine", "Hong Kong"), and CLDR curates both. Most were already Wikidata Aliases. Admitting short names adds only "Bosnia", "Heard & McDonald Islands" and "St. Helena" today.

This widens ADR-0001, where Wikidata supplied the Aliases, and the opening of ADR-0013, where a Locale's Aliases were the labels Wikidata lists: English Aliases now come from CLDR too, and both ADRs say so. CLDR's names go through the same Alias rules as Wikidata's (ADR-0013). They are dropped when they are a code ("US" is the Alpha-2 code of US), equal the Entity's own Name, name a Historic country ("East Timor" names TPTL), or would make an Input ambiguous. Where CLDR and Wikidata give the same Alias, CLDR's spelling ships and the report attributes it to CLDR, since CLDR curates its names while Wikidata's change weekly.

Other `alt` forms are not admitted. CLDR uses them for alternative displays of a disputed or changing name, such as `alt="biot"` and `alt="chagos"` for IO, which let an application choose which name it shows. Admitting a form means naming it in the build's list.

## Considered Options

- **Variant names only**: rejected. Short names are just as much names of their Entity, and leaving them to Wikidata alone leaves them as exposed as "Swaziland" was.
- **Every `alt` form**: rejected. The dispute alternatives are display choices whose meaning CLDR may change. A new form gets reviewed before it ships.
- **Copy the names into the Overlay**: rejected. They would stop following CLDR, and the Overlay is for corrections, not for a second copy of a Source.

## Consequences

Names that CLDR lists keep resolving whatever Wikidata does with them, and the build report shows which Aliases rest on CLDR. A CLDR update can add or drop an Alias, which the data-update PR shows like a Wikidata change. The "Aliases dropped" section of the build report covers CLDR names as well as Wikidata Aliases.
