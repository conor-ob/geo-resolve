import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { build } from "../src/build.ts";
import {
  outputDir,
  writeSnapshots,
  writeOverlay,
  type CldrFixture,
  type WikidataFixture,
} from "./fixtures.ts";

const germanyAndAndorra: CldrFixture = {
  regular: ["DE", "AD"],
  codes: [
    { type: "DE", numeric: "276", alpha3: "DEU" },
    { type: "AD", numeric: "020", alpha3: "AND" },
  ],
  names: [
    { type: "DE", name: "Germany" },
    { type: "AD", name: "Andorra" },
  ],
};

const germanyItems: WikidataFixture["items"] = [
  { item: "Q183", alpha2: "DE" },
  { item: "Q228", alpha2: "AD" },
];

interface Built {
  countries: { id: string; codes?: Record<string, string> }[];
  aliases: Record<string, string[]>;
  subdivisions: (country: string) => Promise<{ id: string; codes?: Record<string, string> }[]>;
  report: string;
}

async function buildWith(
  wikidata: WikidataFixture,
  { cldr = germanyAndAndorra, overlay = {} }: { cldr?: CldrFixture; overlay?: unknown } = {},
): Promise<Built> {
  const outDir = await outputDir();
  const reportPath = join(outDir, "report.md");
  await build({
    sourcesDir: await writeSnapshots(cldr, wikidata),
    overlayPath: await writeOverlay(overlay),
    outDir,
    reportPath,
  });
  const json = async (path: string) => JSON.parse(await readFile(join(outDir, path), "utf8"));
  return {
    countries: await json("countries.json"),
    aliases: await json("countries.aliases.json"),
    subdivisions: (country) => json(join("subdivisions", `${country}.json`)),
    report: await readFile(reportPath, "utf8"),
  };
}

test("an IOC code from Wikidata joins to the Country whose Alpha-2 code its item holds", async () => {
  const { countries } = await buildWith({
    items: germanyItems,
    ioc: [{ item: "Q183", ioc: "GER" }],
  });
  expect(countries.map(({ id, codes }) => ({ id, codes }))).toEqual([
    { id: "AD", codes: undefined },
    { id: "DE", codes: { ioc: "GER" } },
  ]);
});

const netherlands: CldrFixture = {
  regular: ["NL"],
  codes: [{ type: "NL", numeric: "528", alpha3: "NLD" }],
  names: [{ type: "NL", name: "Netherlands" }],
};

// ISO NL is on Q29999 (Kingdom of the Netherlands), while Q55 (Netherlands) holds the IOC code and Aliases.
const netherlandsItems: WikidataFixture = {
  items: [
    { item: "Q29999", alpha2: "NL" },
    { item: "Q55", alpha2: "NL", deprecated: true },
  ],
  ioc: [{ item: "Q55", ioc: "NED" }],
};

const pinQ55 = {
  wikidataItems: [{ country: "NL", item: "Q55", reason: "Q55 holds the Netherlands' other codes" }],
};

test("an Overlay names the Wikidata item a Country is read from, even one whose Alpha-2 code is deprecated", async () => {
  expect(
    (await buildWith(netherlandsItems, { cldr: netherlands })).countries[0]?.codes,
  ).toBeUndefined();
  const { countries } = await buildWith(netherlandsItems, { cldr: netherlands, overlay: pinQ55 });
  expect(countries[0]?.codes).toEqual({ ioc: "NED" });
});

test("fails on an Alpha-2 code held by more than one current Wikidata item, unless the Overlay names one", async () => {
  const cyprus: CldrFixture = {
    regular: ["CY"],
    codes: [{ type: "CY", numeric: "196", alpha3: "CYP" }],
    names: [{ type: "CY", name: "Cyprus" }],
  };
  const twoItems: WikidataFixture = {
    items: [
      { item: "Q229", alpha2: "CY" },
      { item: "Q644636", alpha2: "CY" },
      { item: "Q1", alpha2: "CY", ended: true },
    ],
    ioc: [{ item: "Q229", ioc: "CYP" }],
  };
  await expect(buildWith(twoItems, { cldr: cyprus })).rejects.toThrow(
    "Alpha-2 code CY is on more than one current Wikidata item, Q229, Q644636",
  );
  const overlay = { wikidataItems: [{ country: "CY", item: "Q229", reason: "the state" }] };
  expect((await buildWith(twoItems, { cldr: cyprus, overlay })).countries[0]?.codes).toEqual({
    ioc: "CYP",
  });
});

test.each([
  ["names a Country that doesn't exist", { country: "XX", item: "Q55" }, "dangling Country"],
  ["names an item without the Alpha-2 code", { country: "NL", item: "Q183" }, "doesn't hold"],
  ["names the only current item", { country: "NL", item: "Q29999" }, "no longer needed"],
])("fails on an Overlay Wikidata item that %s", async (_, entry, message) => {
  const overlay = { wikidataItems: [{ ...entry, reason: "because" }] };
  await expect(buildWith(netherlandsItems, { cldr: netherlands, overlay })).rejects.toThrow(
    message,
  );
});

test("Wikidata never adds an Entity or an ISO code: items whose Alpha-2 code isn't a Country are ignored", async () => {
  const { countries } = await buildWith({
    items: [...germanyItems!, { item: "Q1246", alpha2: "XK" }, { item: "Q36704", alpha2: "YU" }],
    ioc: [
      { item: "Q1246", ioc: "KOS" },
      { item: "Q36704", ioc: "YUG" },
    ],
  });
  expect(countries.map(({ id }) => id)).toEqual(["AD", "DE"]);
  expect(countries.every(({ codes }) => codes === undefined)).toBe(true);
});

test("fails on a Code system code shared by two Entities", async () => {
  await expect(
    buildWith({
      items: germanyItems,
      ioc: [
        { item: "Q183", ioc: "GER" },
        { item: "Q228", ioc: "GER" },
      ],
    }),
  ).rejects.toThrow("IOC code GER is on more than one Entity, AD and DE");
});

test("fails on a Country with two IOC codes", async () => {
  await expect(
    buildWith({
      items: germanyItems,
      ioc: [
        { item: "Q183", ioc: "FRG" },
        { item: "Q183", ioc: "GER" },
      ],
    }),
  ).rejects.toThrow("DE has two IOC codes, FRG and GER");
});

test("the build report lists the Countries without an IOC code", async () => {
  const { report } = await buildWith({ items: germanyItems, ioc: [{ item: "Q183", ioc: "GER" }] });
  expect(report).toContain(
    "1 of 2 Countries have an IOC code. The 1 without one:\n\n- AD Andorra\n",
  );
});

// GB and three of its home nations, the Isle of Man, and Anguilla and Hong Kong, whose FIFA associations name GB
// and CN as their country (P17) but their own territory as jurisdiction (P1001) or operating area (P2541).
const unitedKingdom: CldrFixture = {
  regular: ["AI", "CN", "GB", "HK", "IM"],
  codes: [
    { type: "AI", numeric: "660", alpha3: "AIA" },
    { type: "CN", numeric: "156", alpha3: "CHN" },
    { type: "GB", numeric: "826", alpha3: "GBR" },
    { type: "HK", numeric: "344", alpha3: "HKG" },
    { type: "IM", numeric: "833", alpha3: "IMN" },
  ],
  names: [
    { type: "AI", name: "Anguilla" },
    { type: "CN", name: "China" },
    { type: "GB", name: "United Kingdom" },
    { type: "HK", name: "Hong Kong SAR China" },
    { type: "IM", name: "Isle of Man" },
  ],
  subdivisions: {
    regular: ["cnhk", "gbeng", "gbnir", "gbsct"],
    deprecated: [],
    containment: [
      { type: "CN", contains: ["cnhk"] },
      { type: "GB", contains: ["gbeng", "gbnir", "gbsct"] },
    ],
    names: [
      { type: "cnhk", name: "Hong Kong SAR" },
      { type: "gbeng", name: "England" },
      { type: "gbnir", name: "Northern Ireland" },
      { type: "gbsct", name: "Scotland" },
    ],
  },
};

const unitedKingdomItems: WikidataFixture["items"] = [
  { item: "Q25228", alpha2: "AI" },
  { item: "Q148", alpha2: "CN" },
  { item: "Q145", alpha2: "GB" },
  { item: "Q8646", alpha2: "HK" },
  { item: "Q9676", alpha2: "IM" },
];

const associations: WikidataFixture["fifa"] = [
  // The FA's jurisdiction is England and, for football, the Isle of Man.
  { association: "Q9500", fifa: "ENG", property: "P1001", area: "Q21", subdivision: "GB-ENG" },
  { association: "Q9500", fifa: "ENG", property: "P1001", area: "Q9676" },
  { association: "Q9500", fifa: "ENG", property: "P17", area: "Q145" },
  {
    association: "Q478320",
    fifa: "SCO",
    property: "P1001",
    area: "Q22",
    subdivision: "GB-SCT",
  },
  { association: "Q478320", fifa: "SCO", property: "P17", area: "Q145" },
  // Wikidata gives the Irish FA the Republic of Ireland's code.
  {
    association: "Q620280",
    fifa: "IRL",
    property: "P1001",
    area: "Q26",
    subdivision: "GB-NIR",
  },
  { association: "Q2333265", fifa: "AIA", property: "P1001", area: "Q25228" },
  { association: "Q2333265", fifa: "AIA", property: "P17", area: "Q145" },
  // Hong Kong's item holds both its Alpha-2 code and the Subdivision code CN-HK.
  {
    association: "Q622321",
    fifa: "HKG",
    property: "P2541",
    area: "Q8646",
    subdivision: "CN-HK",
  },
  { association: "Q622321", fifa: "HKG", property: "P17", area: "Q148" },
  { association: "Q573747", fifa: "CHN", property: "P17", area: "Q148" },
];

const homeNations = {
  fifaAssociations: [
    { association: "Q9500", entity: "GB-ENG", reason: "The FA's national team represents England" },
  ],
  codes: [
    { entity: "GB-NIR", system: "fifa", code: "NIR", reason: "Wikidata gives the Irish FA IRL" },
  ],
};

async function fifaCodes(overlay: unknown = homeNations): Promise<Record<string, string>> {
  const built = await buildWith(
    { items: unitedKingdomItems, fifa: associations },
    { cldr: unitedKingdom, overlay },
  );
  const entities = [
    ...built.countries,
    ...(await built.subdivisions("GB")),
    ...(await built.subdivisions("CN")),
  ];
  return Object.fromEntries(
    entities.flatMap(({ id, codes }) => (codes?.fifa === undefined ? [] : [[id, codes.fifa]])),
  );
}

test("a FIFA code joins to the territory its association covers: its jurisdiction, else operating area, else country", async () => {
  expect(await fifaCodes()).toEqual({
    AI: "AIA",
    CN: "CHN",
    "GB-ENG": "ENG",
    "GB-NIR": "NIR",
    "GB-SCT": "SCO",
    HK: "HKG",
  });
});

test("fails on a FIFA association that covers several Entities or none, unless the Overlay names its Entity", async () => {
  await expect(fifaCodes({ codes: homeNations.codes })).rejects.toThrow(
    "FIFA association Q9500 (ENG) covers more than one Entity, GB-ENG and IM; name its Entity in the Overlay",
  );
  const unjoined = buildWith(
    {
      items: unitedKingdomItems,
      fifa: [{ association: "Q1289049", fifa: "KVX", property: "P17", area: "Q1246" }],
    },
    { cldr: unitedKingdom },
  );
  await expect(unjoined).rejects.toThrow(
    "FIFA association Q1289049 (KVX) covers no Entity; name its Entity in the Overlay",
  );
});

test("an Overlay omits a FIFA association by naming no Entity", async () => {
  const omitted = {
    ...homeNations,
    fifaAssociations: [
      ...homeNations.fifaAssociations,
      { association: "Q2333265", entity: null, reason: "not a FIFA member" },
    ],
  };
  expect(await fifaCodes(omitted)).not.toHaveProperty("AI");
});

test.each([
  [
    "a dangling association",
    {
      fifaAssociations: [
        ...homeNations.fifaAssociations,
        { association: "Q1", entity: "GB", reason: "x" },
      ],
    },
    "FIFA association Q1 in the Overlay isn't in the Snapshot",
  ],
  [
    "a dangling Entity",
    { fifaAssociations: [{ association: "Q9500", entity: "GB-XXX", reason: "x" }] },
    "FIFA association Q9500 has a dangling Entity GB-XXX",
  ],
  [
    "a code correction that matches Wikidata",
    {
      ...homeNations,
      codes: [...homeNations.codes, { entity: "AI", system: "fifa", code: "AIA", reason: "x" }],
    },
    "FIFA code correction for AI matches Wikidata, so it is no longer needed",
  ],
  [
    "a code correction for a dangling Entity",
    {
      ...homeNations,
      codes: [...homeNations.codes, { entity: "GB-WLS", system: "fifa", code: "WAL", reason: "x" }],
    },
    "FIFA code correction has a dangling Entity GB-WLS",
  ],
])("fails on an Overlay with %s", async (_, overlay, message) => {
  await expect(fifaCodes(overlay)).rejects.toThrow(message);
});

test("an Overlay code correction adds a code Wikidata lacks", async () => {
  const overlay = {
    ...homeNations,
    codes: [...homeNations.codes, { entity: "IM", system: "ioc", code: "IOM", reason: "x" }],
  };
  const { countries } = await buildWith(
    { items: unitedKingdomItems, fifa: associations },
    { cldr: unitedKingdom, overlay },
  );
  expect(countries.find(({ id }) => id === "IM")?.codes).toEqual({ ioc: "IOM" });
});

test("Wikidata labels and aliases of a Country's item become its Aliases, except its own Name", async () => {
  const { aliases } = await buildWith(
    {
      ...netherlandsItems,
      aliases: [
        { item: "Q55", alias: "Netherlands" },
        { item: "Q55", alias: "Holland" },
        { item: "Q55", alias: "the Netherlands" },
        { item: "Q29999", alias: "Kingdom of the Netherlands" },
      ],
    },
    { cldr: netherlands, overlay: pinQ55 },
  );
  expect(aliases).toEqual({ NL: ["Holland", "the Netherlands"] });
});

test("the build report states the Source of each Name, Alias and Code system code", async () => {
  const overlay = {
    ...pinQ55,
    formerCodes: [{ country: "NL", code: "HOL", citation: "test" }],
    codes: [{ entity: "NL", system: "fifa", code: "NED", reason: "x" }],
  };
  const { report } = await buildWith(
    { ...netherlandsItems, aliases: [{ item: "Q55", alias: "Holland" }] },
    { cldr: netherlands, overlay },
  );
  expect(report).toContain("| Country | CLDR | 1 |");
  expect(report).toContain("| NL | alpha3 | HOL |");
  expect(report).toContain("| NL | Holland | Wikidata Q55 |");
  expect(report).toContain("| NL | IOC | NED | Wikidata Q55 |");
  expect(report).toContain("| NL | FIFA | NED | Overlay |");
});

const eswatini: CldrFixture = {
  regular: ["SZ"],
  codes: [{ type: "SZ", numeric: "748", alpha3: "SWZ" }],
  names: [
    { type: "SZ", name: "Eswatini" },
    { type: "SZ", name: "Swaziland", alt: "variant" },
  ],
};

test("a CLDR variant English name is an Alias from CLDR, even with no Wikidata Alias", async () => {
  const { aliases, report } = await buildWith(
    { items: [{ item: "Q1050", alpha2: "SZ" }] },
    { cldr: eswatini },
  );
  expect(aliases).toEqual({ SZ: ["Swaziland"] });
  expect(report).toContain("| SZ | Swaziland | CLDR |");
});

test("a CLDR short English name is an Alias too, but other alt forms aren't", async () => {
  const { aliases, report } = await buildWith(
    {},
    {
      cldr: {
        regular: ["BA", "IO"],
        codes: [
          { type: "BA", numeric: "070", alpha3: "BIH" },
          { type: "IO", numeric: "086", alpha3: "IOT" },
        ],
        names: [
          { type: "BA", name: "Bosnia & Herzegovina" },
          { type: "BA", name: "Bosnia", alt: "short" },
          { type: "IO", name: "British Indian Ocean Territory" },
          { type: "IO", name: "Chagos Archipelago", alt: "chagos" },
        ],
      },
    },
  );
  expect(aliases).toEqual({ BA: ["Bosnia"] });
  expect(report).toContain("| BA | Bosnia | CLDR |");
});

const greece: CldrFixture = {
  regular: ["GR"],
  codes: [{ type: "GR", numeric: "300", alpha3: "GRC" }],
  names: [{ type: "GR", name: "Greece" }],
};

test("fails on an Overlay Alias entry with no reason", async () => {
  const overlay = { removedAliases: [{ entity: "GR", alias: "el", reason: "" }] };
  await expect(
    buildWith({ items: [{ item: "Q41", alpha2: "GR" }] }, { cldr: greece, overlay }),
  ).rejects.toThrow("must give a reason");
});
