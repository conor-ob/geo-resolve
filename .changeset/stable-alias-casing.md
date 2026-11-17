---
"geo-resolve": patch
---

When Aliases differ only in case, ship the one with the most capitals, so the stored casing no longer depends on which variants Wikidata happens to keep. The Northern Mariana Islands' "nmi" is now "NMI" and Zambia's "Zed" is now "ZED". Matching ignores case, so resolution is unchanged.
