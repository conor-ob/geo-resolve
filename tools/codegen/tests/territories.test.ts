import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { build } from "../src/build.ts";
import {
  outputDir,
  writeCldrSnapshots,
  writeOverlay,
  type CldrFixture,
  type WikidataFixture,
} from "./fixtures.ts";

const germanyAndKosovo: CldrFixture = {
  regular: ["DE", "XK"],
  codes: [
    { type: "DE", numeric: "276", alpha3: "DEU" },
    { type: "XK", numeric: "983", alpha3: "XKK" },
  ],
  names: [
    { type: "DE", name: "Germany" },
    { type: "XK", name: "Kosovo" },
  ],
};

const kosovoWikidata: WikidataFixture = {
  items: [
    { item: "Q183", alpha2: "DE" },
    { item: "Q1246", alpha2: "XK" },
  ],
  ioc: [
    { item: "Q183", ioc: "GER" },
    { item: "Q1246", ioc: "KOS" },
  ],
  fifa: [{ association: "Q1289049", fifa: "KVX", property: "P17", area: "Q1246" }],
  aliases: [
    { item: "Q1246", alias: "Kosovo" },
    { item: "Q1246", alias: "Republic of Kosovo" },
    { item: "Q1246", alias: "KOS" },
    { item: "Q1246", alias: "XK" },
  ],
};

const kosovo = {
  id: "XK",
  name: "Kosovo",
  codeSystems: ["ioc", "fifa"],
  reason: "IOC and FIFA code KOS",
};

const kosovoOverlay = {
  territories: [kosovo],
  codes: [
    {
      entity: "XK",
      system: "fifa",
      code: "KOS",
      reason: "Wikidata's KVX disagrees with FIFA's KOS",
    },
  ],
};

async function buildTerritories({
  cldr = germanyAndKosovo,
  wikidata = kosovoWikidata,
  overlay = kosovoOverlay,
}: { cldr?: CldrFixture; wikidata?: WikidataFixture; overlay?: unknown } = {}) {
  const outDir = await outputDir();
  const reportPath = join(outDir, "report.md");
  await build({
    sourcesDir: await writeCldrSnapshots(cldr, wikidata),
    overlayPath: await writeOverlay(overlay),
    outDir,
    reportPath,
  });
  const json = async (path: string) => JSON.parse(await readFile(join(outDir, path), "utf8"));
  return {
    territories: await json("territories.json"),
    aliases: await json("territories.aliases.json"),
    countries: await json("countries.json"),
    report: await readFile(reportPath, "utf8"),
  };
}

test("a Territory is built from the Overlay, with the Code system codes and Aliases joined from Wikidata", async () => {
  const { territories, aliases, countries } = await buildTerritories();
  expect(territories).toEqual([
    { kind: "territory", id: "XK", name: "Kosovo", codes: { ioc: "KOS", fifa: "KOS" } },
  ]);
  expect(aliases).toEqual({ XK: ["Republic of Kosovo"] });
  expect(countries.map(({ id }: { id: string }) => id)).toEqual(["DE"]);
});

test("the build report states the Source of a Territory's Name and codes", async () => {
  const { report } = await buildTerritories();
  expect(report).toContain("| Territory | Overlay | 1 |");
  expect(report).toContain("| XK | IOC | KOS | Wikidata Q1246 |");
  expect(report).toContain("| XK | FIFA | KOS | Overlay |");
});

// ISO lists Kosovo as the Serbian Subdivision RS-KM, with a district RS-25 named Kosovo, so a Subdivision's Name says
// nothing about whether a unit is a Territory; CLDR listing it as a region of its own does (ADR-0012).
test("a Territory is admitted even where a Subdivision shares its Name", async () => {
  const { territories } = await buildTerritories({
    cldr: {
      ...germanyAndKosovo,
      subdivisions: {
        regular: ["debe"],
        containment: [{ type: "DE", contains: ["debe"] }],
        names: [{ type: "debe", name: "Kosovo" }],
      },
    },
  });
  expect(territories.map(({ id }: { id: string }) => id)).toEqual(["XK"]);
});

test.each([
  [
    "a Territory ISO lists as a Country",
    { overlay: { ...kosovoOverlay, territories: [{ ...kosovo, name: "Germany" }] } },
    "Territory XK Germany is listed by ISO as the Country DE, so it isn't a Territory",
  ],
  [
    "a Territory whose id is an ISO code",
    { overlay: { ...kosovoOverlay, territories: [{ ...kosovo, id: "DE" }] } },
    "must be a user-assigned code, XA–XZ",
  ],
  [
    "a Territory CLDR doesn't list as a region",
    { cldr: { ...germanyAndKosovo, regular: ["DE"] } },
    "Territory XK isn't a CLDR region, so it has no localised Names",
  ],
  [
    "a Territory coded by only one shipped Code system",
    { wikidata: { ...kosovoWikidata, fifa: [] }, overlay: { territories: [kosovo] } },
    "Territory XK is coded by IOC, but needs at least two shipped Code systems to be admitted",
  ],
  [
    "a Territory coded by no shipped Code system",
    { wikidata: { items: kosovoWikidata.items }, overlay: { territories: [kosovo] } },
    "Territory XK is coded by no Code system, but needs at least two shipped Code systems to be admitted",
  ],
  [
    "a Territory admitted for Code systems other than those that code it",
    { overlay: { ...kosovoOverlay, territories: [{ ...kosovo, codeSystems: ["ioc"] }] } },
    "Territory XK is admitted for its IOC codes, but is coded by IOC and FIFA",
  ],
  [
    "a Territory listed twice",
    { overlay: { ...kosovoOverlay, territories: [kosovo, kosovo] } },
    "Duplicate id XK",
  ],
])("fails on %s", async (_, fixture, message) => {
  await expect(buildTerritories(fixture)).rejects.toThrow(message);
});
