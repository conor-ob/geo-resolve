---
"geo-resolve": patch
---

Read Aliases from Wikidata's multilingual (`mul`) labels and aliases as well as English ones. Wikidata has moved names that read the same in every language, such as Eswatini's "Swaziland", Vietnam's "Viet Nam" and "UK", from English to `mul`. Reading only English would have dropped them. Only Latin-script `mul` names are kept. This adds about 100 Aliases.
