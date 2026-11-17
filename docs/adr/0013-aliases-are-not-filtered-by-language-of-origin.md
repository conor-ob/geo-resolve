# Aliases are not filtered by language of origin

A Locale's Aliases are the labels Wikidata lists for the Entity in that Locale's language, whatever language they come from. English Aliases already hold endonyms people type in English text ("Danmark", "Sakartvelo", "Misr", "Kalaallit Nunaat") and names from other languages ("Birmania", "Giordania", "Camboya", "Danemark"). geo-resolve keeps both, and doesn't try to tell them apart.

Aliases are dropped by rule only when they would do harm, the same rules in every Locale:

- They are not name-shaped, are a code, or name a Historic country.
- They equal the Entity's own Name in that Locale.
- They equal a different Entity's Name in the same Locale, unless a Same-as link joins the two ("Hong Kong" stays an Alias of HK). Such an Alias would make a common Input an Ambiguous input, which, as ADR-0009 promises, the default English Resolver never has.

Anything else that is wrong (a vandalised or junk label the rules don't catch) is removed by hand through the Overlay, so the fix is reviewed and survives the weekly data update.

A foreign name can't make `resolve` return a wrong Entity: an Input that matches two Entities is ambiguous and returns `null` (ADR-0004). So the worst a stray foreign name can do is make an Input ambiguous, which the clash rule above prevents, while removing names stops real Inputs from resolving.

## Considered Options

- **Drop every Alias that isn't English**: rejected. Telling languages apart needs per-name judgement Wikidata doesn't record, and it would drop endonyms that turn up in English data.
- **Keep endonyms, drop names from third languages**: rejected. It needs each Entity's official languages and a match against every Locale's Names, still misses forms that differ from the CLDR Name (CLDR's Spanish name for Myanmar is "Myanmar (Birmania)", not "Birmania"), and turns every weekly data-update review into a language call.
- **Move foreign names into their own Locale packs**: rejected for the same detection problem. Localised Aliases from Wikidata already come into each Locale pack on their own.
- **Accept Wikidata's labels with no clash rule for English**: rejected. A single upstream edit could make a common English Input ambiguous without anyone noticing.

## Consequences

Names like "Birmania" keep resolving for English-only callers, which is harmless and helps with messy input. Reviewers of data-update PRs check new Aliases for harm (clashes, junk, vandalism), not for language. The Overlay needs a way to remove an Alias from any Entity, and the English build needs the same clash rule as the Locale packs.
