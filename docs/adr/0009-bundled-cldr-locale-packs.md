# Bundled CLDR Locale packs instead of Intl.DisplayNames

Localisation ships as generated Locale packs (`geo-resolve/locales/<locale>`) rather than relying on the runtime's `Intl.DisplayNames`. `Intl.DisplayNames` costs nothing in bundle size, but it only covers Country names, has no Subdivision names, cannot map a localised name back to an Entity ("Deutschland" → DE), and its output varies between runtimes. A Locale pack serves both directions (display and resolution) from the same data and gives identical results everywhere. `Intl.DisplayNames` may later be offered as an optional display-only fallback.

Coverage is every CLDR locale at "moderate" coverage or above (roughly 100–150 Locales), where names are reliable. CLDR's Subdivision names are thin in many Locales, so missing ones are filled from Wikidata labels. Where each name came from is recorded in a build report, not in the shipped data.
