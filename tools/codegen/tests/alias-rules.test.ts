import type { Country, HistoricCountry, Subdivision } from "geo-resolve";
import { expect, test } from "vite-plus/test";
import {
  applyAliasRules,
  type AliasCandidate,
  type AliasRuleEntities,
  type DroppedAlias,
} from "../src/alias-rules.ts";
import type { Overlay } from "../src/overlay.ts";
import type { AliasLanguage } from "../src/wikidata.ts";

function country(id: string, name: string, alpha3: string, numeric: string): Country {
  return { kind: "country", id, alpha2: id, alpha3, numeric, name };
}

function subdivision(id: string, name: string): Subdivision {
  const country = id.slice(0, 2);
  return { kind: "subdivision", id, code: id, country, parent: country, name };
}

const southernRhodesia: HistoricCountry = {
  kind: "historic-country",
  id: "RHZW",
  alpha4: "RHZW",
  alpha2: "RH",
  name: "Southern Rhodesia",
  withdrawn: "1980",
  successors: ["ZW"],
};

/** A Wikidata label of `item`, for the Entity with this `id`. */
function wikidata(
  id: string,
  item: string,
  alias: string,
  lang: AliasLanguage = "en",
): AliasCandidate {
  return { id, alias, origin: { source: "Wikidata", item, lang } };
}

/** A CLDR variant or short name of the Entity with this `id` (ADR-0014). */
function cldr(id: string, alias: string): AliasCandidate {
  return { id, alias, origin: { source: "CLDR" } };
}

type OverlayAlias = Overlay["addedAliases"][number];

/** Runs the Alias rules, returning the shipped Aliases by Entity, sorted like the Data packs, with drops and problems. */
function rules({
  entities,
  candidates = [],
  addedAliases = [],
  removedAliases = [],
}: {
  entities: Partial<AliasRuleEntities>;
  candidates?: AliasCandidate[];
  addedAliases?: OverlayAlias[];
  removedAliases?: OverlayAlias[];
}): {
  aliases: Record<string, string[]>;
  sources: Record<string, string>;
  dropped: DroppedAlias[];
  problems: string[];
} {
  const problems: string[] = [];
  const result = applyAliasRules({
    entities: {
      countries: [],
      territories: [],
      subdivisions: [],
      historicCountries: [],
      historicAliases: new Map(),
      formerCodes: new Map(),
      sameAs: new Map(),
      ...entities,
    },
    candidates,
    overlay: { addedAliases, removedAliases },
    problems,
  });
  const aliases: Record<string, string[]> = {};
  const sources: Record<string, string> = {};
  for (const { id, alias, source } of result.aliases) {
    (aliases[id] ??= []).push(alias);
    sources[`${id} ${alias}`] = source;
  }
  for (const list of Object.values(aliases)) list.sort();
  return { aliases, sources, dropped: result.dropped, problems };
}

test("a candidate is dropped when it is any Entity's code or a Historic country's Name or Alias", () => {
  const saudiArabia = country("SA", "Saudi Arabia", "SAU", "682");
  const southAfrica = { ...country("ZA", "South Africa", "ZAF", "710"), codes: { ioc: "RSA" } };
  const { aliases, dropped } = rules({
    entities: {
      countries: [saudiArabia, southAfrica],
      historicCountries: [southernRhodesia],
      historicAliases: new Map([["RHZW", ["Rhodesia"]]]),
    },
    candidates: [
      "SA",
      "zaf",
      "RSA",
      "Southern Rhodesia",
      "Rhodesia",
      "Republic of South Africa",
    ].map((alias) => wikidata("ZA", "Q258", alias)),
  });
  expect(aliases).toEqual({ ZA: ["Republic of South Africa"] });
  expect(dropped).toEqual([
    { id: "ZA", alias: "RSA", reason: "a code of ZA" },
    { id: "ZA", alias: "Rhodesia", reason: "an Alias of the Historic country RHZW" },
    { id: "ZA", alias: "SA", reason: "a code of SA" },
    { id: "ZA", alias: "Southern Rhodesia", reason: "the Name of the Historic country RHZW" },
    { id: "ZA", alias: "zaf", reason: "a code of ZA" },
  ]);
});

test("a candidate is dropped when it is a former code of a Country that still exists", () => {
  const { aliases, dropped } = rules({
    entities: {
      countries: [country("RO", "Romania", "ROU", "642"), country("MD", "Moldova", "MDA", "498")],
      formerCodes: new Map([["RO", { alpha3: ["ROM"] }]]),
    },
    candidates: [wikidata("MD", "Q217", "Rom"), wikidata("MD", "Q217", "Republic of Moldova")],
  });
  expect(aliases).toEqual({ MD: ["Republic of Moldova"] });
  expect(dropped).toEqual([{ id: "MD", alias: "Rom", reason: "a code of RO" }]);
});

const germany = country("DE", "Germany", "DEU", "276");

test("a candidate that isn't a name, such as a flag, a time zone or a calling code, is dropped", () => {
  const { aliases, dropped } = rules({
    entities: { countries: [germany] },
    candidates: [
      "🇩🇪",
      "ISO 3166-1:DE",
      "Europe/Berlin",
      "+49",
      "Bundesrepublik Deutschland",
      "Deutschland (BRD)",
    ].map((alias) => wikidata("DE", "Q183", alias)),
  });
  expect(aliases).toEqual({ DE: ["Bundesrepublik Deutschland", "Deutschland (BRD)"] });
  expect(dropped.map(({ alias, reason }) => [alias, reason])).toEqual(
    ["+49", "Europe/Berlin", "ISO 3166-1:DE", "🇩🇪"].map((alias) => [alias, "not a name"]),
  );
});

test("multilingual (mul) labels are candidates too, except those not in Latin script", () => {
  const { aliases, dropped } = rules({
    entities: { countries: [country("VN", "Vietnam", "VNM", "704")] },
    candidates: [
      wikidata("VN", "Q881", "Vietnam"),
      wikidata("VN", "Q881", "Viet Nam", "mul"),
      wikidata("VN", "Q881", "Việt Nam", "mul"),
      wikidata("VN", "Q881", "Socialist Republic of Vietnam"),
      wikidata("VN", "Q881", "Socialist Republic of Vietnam", "mul"),
      wikidata("VN", "Q881", "越南社會主義共和國", "mul"),
    ],
  });
  expect(aliases).toEqual({ VN: ["Socialist Republic of Vietnam", "Viet Nam"] });
  expect(dropped).toEqual([
    { id: "VN", alias: "越南社會主義共和國", reason: "not in Latin script" },
  ]);
});

test("an English label keeps its spelling over a multilingual (mul) one that differs in accents", () => {
  const { aliases } = rules({
    entities: { countries: [country("AX", "Åland Islands", "ALA", "248")] },
    candidates: [wikidata("AX", "Q5689", "Åland", "mul"), wikidata("AX", "Q5689", "Aland")],
  });
  expect(aliases).toEqual({ AX: ["Aland"] });
});

const northernMarianaIslandsLabels = [
  wikidata("MP", "Q16644", "nmi"),
  wikidata("MP", "Q16644", "Nmi"),
  wikidata("MP", "Q16644", "NMI", "mul"),
  wikidata("MP", "Q16644", "mp"),
  wikidata("MP", "Q16644", "MP", "mul"),
];

test.each([
  ["in order", northernMarianaIslandsLabels],
  ["reversed", [...northernMarianaIslandsLabels].reverse()],
])(
  "labels that differ only in case ship the variant with the most capitals, whatever their language: %s",
  (_, candidates) => {
    const { aliases, dropped } = rules({
      entities: { countries: [country("MP", "Northern Mariana Islands", "MNP", "580")] },
      candidates,
    });
    expect(aliases).toEqual({ MP: ["NMI"] });
    expect(dropped).toEqual([{ id: "MP", alias: "MP", reason: "a code of MP" }]);
  },
);

test("an English label outside Latin script still ships when a multilingual (mul) one differs only in case", () => {
  const { aliases } = rules({
    entities: { countries: [country("GR", "Greece", "GRC", "300")] },
    candidates: [wikidata("GR", "Q41", "Ελλάδα"), wikidata("GR", "Q41", "ΕΛΛΆΔΑ", "mul")],
  });
  expect(aliases).toEqual({ GR: ["ΕΛΛΆΔΑ"] });
});

test("a candidate is dropped when it is another Entity's Name, unless a Same-as link joins the two", () => {
  const entities = {
    countries: [
      country("PR", "Puerto Rico", "PRI", "630"),
      country("US", "United States", "USA", "840"),
    ],
    subdivisions: [subdivision("US-CA", "California"), subdivision("US-PR", "Puerto Rico")],
  };
  const unlinked = rules({
    entities,
    candidates: ["California", "puerto rico", "America"].map((alias) =>
      wikidata("US", "Q30", alias),
    ),
  });
  expect(unlinked.aliases).toEqual({ US: ["America"] });
  expect(unlinked.dropped).toEqual([
    { id: "US", alias: "California", reason: "the Name of US-CA" },
    { id: "US", alias: "puerto rico", reason: "the Name of PR and US-PR" },
  ]);

  const linked = rules({
    entities: {
      ...entities,
      sameAs: new Map([
        ["PR", ["US-PR"]],
        ["US-PR", ["PR"]],
      ]),
    },
    candidates: [wikidata("PR", "Q1183", "Puerto Rico"), wikidata("PR", "Q1183", "Porto Rico")],
  });
  expect(linked.aliases).toEqual({ PR: ["Porto Rico"] });
});

const congo: Partial<AliasRuleEntities> = {
  countries: [
    country("CD", "Congo - Kinshasa", "COD", "180"),
    country("CG", "Congo - Brazzaville", "COG", "178"),
  ],
};
const congoLabels = [
  wikidata("CD", "Q974", "Congo", "mul"),
  wikidata("CD", "Q974", "DR Congo"),
  wikidata("CG", "Q971", "Congo"),
  wikidata("CG", "Q971", "Congo-Brazzaville"),
];

test("an Alias of more than one Entity is dropped from each, so it can't make an Input ambiguous", () => {
  const { aliases, dropped } = rules({ entities: congo, candidates: congoLabels });
  expect(aliases).toEqual({ CD: ["DR Congo"], CG: ["Congo-Brazzaville"] });
  expect(dropped).toEqual([
    { id: "CD", alias: "Congo", reason: "also an Alias of CG" },
    { id: "CG", alias: "Congo", reason: "also an Alias of CD" },
  ]);
});

const eswatini = country("SZ", "Eswatini", "SWZ", "748");

test("a CLDR name ships over the same Wikidata label, and is dropped like one when it breaks a rule", () => {
  const { aliases, sources, dropped } = rules({
    entities: { countries: [eswatini, country("TR", "Türkiye", "TUR", "792")] },
    candidates: [
      wikidata("SZ", "Q1050", "SWAZILAND"),
      wikidata("SZ", "Q1050", "Swaziland", "mul"),
      cldr("SZ", "Swaziland"),
      cldr("TR", "Eswatini"),
    ],
  });
  expect(aliases).toEqual({ SZ: ["Swaziland"] });
  expect(sources).toEqual({ "SZ Swaziland": "CLDR" });
  expect(dropped).toEqual([{ id: "TR", alias: "Eswatini", reason: "the Name of SZ" }]);
});

const greece = country("GR", "Greece", "GRC", "300");
const greeceLabels = ["Hellas", "el", "GRC"].map((alias) => wikidata("GR", "Q41", alias));

test("an Overlay removes an Alias from the Sources, whatever its case, and says why", () => {
  const { aliases, dropped } = rules({
    entities: { countries: [greece] },
    candidates: greeceLabels,
    removedAliases: [{ entity: "GR", alias: "EL", reason: "the language code for Greek" }],
  });
  expect(aliases).toEqual({ GR: ["Hellas"] });
  expect(dropped).toContainEqual({
    id: "GR",
    alias: "el",
    reason: "removed by the Overlay: the language code for Greek",
  });
});

test("an Overlay removing a shared Alias from one Entity gives it back to the other", () => {
  const { aliases } = rules({
    entities: congo,
    candidates: congoLabels,
    removedAliases: [{ entity: "CD", alias: "Congo", reason: "ISO's short name for CG" }],
  });
  expect(aliases).toEqual({ CD: ["DR Congo"], CG: ["Congo", "Congo-Brazzaville"] });
});

test.each<[string, OverlayAlias[], string]>([
  [
    "a removal that matches no Alias from the Sources",
    [{ entity: "GR", alias: "Hellenic Republic", reason: "x" }],
    "Overlay removal of Hellenic Republic from GR matches no Alias from the Sources, so it is no longer needed",
  ],
  [
    "a removal of an Alias a rule already drops",
    [{ entity: "GR", alias: "GRC", reason: "x" }],
    "Overlay removal of GRC from GR matches an Alias already dropped as a code of GR, so it is no longer needed",
  ],
  [
    "a removal for an unknown Entity",
    [{ entity: "ZZ", alias: "el", reason: "x" }],
    "Overlay removal of el has a dangling Entity ZZ",
  ],
  [
    "a removal for a Historic country",
    [{ entity: "RHZW", alias: "Rhodesia", reason: "x" }],
    "Overlay removal of Rhodesia is for the Historic country RHZW; edit the Aliases listed on it instead",
  ],
  [
    "a removal listed twice",
    [
      { entity: "GR", alias: "el", reason: "x" },
      { entity: "GR", alias: "EL", reason: "y" },
    ],
    "Overlay removal of EL from GR is listed twice",
  ],
])("a problem for an Overlay with %s", (_, removedAliases, message) => {
  const { problems } = rules({
    entities: { countries: [greece], historicCountries: [southernRhodesia] },
    candidates: greeceLabels,
    removedAliases,
  });
  expect(problems).toContain(message);
});

test("an Overlay adds an Alias the Sources lack, with the Overlay as its Source", () => {
  const { aliases, sources } = rules({
    entities: { countries: [greece] },
    candidates: greeceLabels,
    addedAliases: [{ entity: "GR", alias: "Hellenic Republic", reason: "Wikidata dropped it" }],
  });
  expect(aliases).toEqual({ GR: ["Hellas", "Hellenic Republic", "el"] });
  expect(sources["GR Hellenic Republic"]).toBe("Overlay");
});

test.each<[string, { addedAliases: OverlayAlias[]; removedAliases?: OverlayAlias[] }, string]>([
  [
    "an addition the Sources already give",
    { addedAliases: [{ entity: "GR", alias: "HELLAS", reason: "x" }] },
    "Overlay Alias HELLAS for GR is also from Wikidata Q41, so it is no longer needed",
  ],
  [
    "an addition that is the Entity's Name",
    { addedAliases: [{ entity: "GR", alias: "greece", reason: "x" }] },
    "Overlay Alias greece for GR is its Name",
  ],
  [
    "an addition that is a code",
    { addedAliases: [{ entity: "GR", alias: "DEU", reason: "x" }] },
    "Overlay Alias DEU for GR is a code of DE",
  ],
  [
    "an addition that is another Entity's Alias",
    {
      addedAliases: [
        { entity: "GR", alias: "Hellenic Republic", reason: "x" },
        { entity: "DE", alias: "Hellenic Republic", reason: "x" },
      ],
    },
    "Overlay Alias Hellenic Republic for DE is also an Alias of GR",
  ],
  [
    "an addition that is also removed",
    {
      addedAliases: [{ entity: "GR", alias: "Hellenic Republic", reason: "x" }],
      removedAliases: [{ entity: "GR", alias: "Hellenic Republic", reason: "x" }],
    },
    "Overlay Alias Hellenic Republic for GR is also removed by the Overlay",
  ],
  [
    "an addition for an unknown Entity",
    { addedAliases: [{ entity: "ZZ", alias: "Zed", reason: "x" }] },
    "Overlay Alias Zed has a dangling Entity ZZ",
  ],
  [
    "an addition for a Historic country",
    { addedAliases: [{ entity: "RHZW", alias: "Rhodesia", reason: "x" }] },
    "Overlay Alias Rhodesia is for the Historic country RHZW; edit the Aliases listed on it instead",
  ],
])("a problem for an Overlay with %s", (_, overlay, message) => {
  const { problems } = rules({
    entities: { countries: [greece, germany], historicCountries: [southernRhodesia] },
    candidates: greeceLabels,
    ...overlay,
  });
  expect(problems).toContain(message);
});
