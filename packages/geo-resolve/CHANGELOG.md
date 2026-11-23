# geo-resolve

## 0.1.3

### Patch Changes

- 65f9bf0: Admit CLDR's variant and short English territory names as Aliases, so names such as Eswatini's "Swaziland" keep resolving even if Wikidata drops them. This adds "Congo (DRC)", "Congo (Republic)", "Falkland Islands (Islas Malvinas)", "Bosnia", "Heard & McDonald Islands" and "St. Helena".
- d053450: Update the data from the latest Wikidata Snapshot.
- beb9c7f: Read Aliases from Wikidata's multilingual (`mul`) labels and aliases as well as English ones. Wikidata has moved names that read the same in every language, such as Eswatini's "Swaziland", Vietnam's "Viet Nam" and "UK", from English to `mul`. Reading only English would have dropped them. Only Latin-script `mul` names are kept. This adds about 100 Aliases.
- 5265847: Remove junk Aliases the Alias rules don't catch: "el" (Greece), "ce" and "lke" (Sri Lanka), ".re" (Réunion), "MXN" (Mexico) and "Ꜵ" (Angola). "Congo" resolves to the Republic of the Congo (CG) again, matching ISO 3166's short name, rather than to nothing.
- aa070fe: When Aliases differ only in case, ship the one with the most capitals, so the stored casing no longer depends on which variants Wikidata happens to keep. The Northern Mariana Islands' "nmi" is now "NMI" and Zambia's "Zed" is now "ZED". Matching ignores case, so resolution is unchanged.
- 937d811: Drop English Aliases that would make an Input ambiguous: those equal to a different Entity's Name, unless a Same-as link joins the two, and those held by more than one Entity. "Norfolk" is no longer an Alias of Norfolk Island, since it is the Name of the Subdivision GB-NFK, and "Congo", "JA", "Saint Martin" and "St Martin" no longer match two Countries each.

## 0.1.2

### Patch Changes

- 191bbe5: Update the data from the latest CLDR and Wikidata Snapshots: add "Birmania" as an Alias of Myanmar, and store Ukraine's "Ukraina" Alias as "Ukraïna", following Wikidata. Inputs match regardless of diacritics, so "Ukraina" still resolves to Ukraine.

## 0.1.1

### Patch Changes

- 0040166: Add npm keywords and a plainer description so the package is easier to find.

## 0.1.0

### Minor Changes

- 13f3de9: The first release. Resolves ISO 3166 codes, English Names and Aliases to Countries, Subdivisions, Historic countries and Territories, with `kinds`, `within` and `from` to narrow ambiguous Inputs. Data from Unicode CLDR and Wikidata.
