import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { build } from "../src/build.ts";
import { outputDir, writeCldrSnapshots, type CldrFixture } from "./fixtures.ts";

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

async function emitCountries(fixture: CldrFixture): Promise<string> {
  const outDir = await outputDir();
  await build({ sourcesDir: await writeCldrSnapshots(fixture), outDir });
  return readFile(join(outDir, "countries.json"), "utf8");
}

async function buildCountries(fixture: CldrFixture): Promise<unknown> {
  return JSON.parse(await emitCountries(fixture));
}

test("emits a Countries Data pack sorted by id", async () => {
  expect(await buildCountries(germanyAndAndorra)).toEqual([
    { kind: "country", id: "AD", alpha2: "AD", alpha3: "AND", numeric: "020", name: "Andorra" },
    { kind: "country", id: "DE", alpha2: "DE", alpha3: "DEU", numeric: "276", name: "Germany" },
  ]);
});

test("Countries are the regular CLDR regions that ISO assigns, with their default English Name", async () => {
  const countries = await buildCountries({
    regular: ["AC", "AD~E", "XK"],
    deprecated: ["YU"],
    codes: [
      { type: "AC", alpha3: "ASC" },
      { type: "AD", numeric: "020", alpha3: "AND" },
      { type: "AE", numeric: "784", alpha3: "ARE" },
      { type: "XK", numeric: "983", alpha3: "XKK" },
      { type: "YU", numeric: "891", alpha3: "YUG" },
    ],
    names: [
      { type: "AC", name: "Ascension Island" },
      { type: "AD", name: "Andorra" },
      { type: "AE", name: "United Arab Emirates" },
      { type: "AE", name: "UAE", alt: "short" },
      { type: "XK", name: "Kosovo" },
      { type: "YU", name: "Yugoslavia" },
    ],
  });
  expect(countries).toEqual([
    { kind: "country", id: "AD", alpha2: "AD", alpha3: "AND", numeric: "020", name: "Andorra" },
    {
      kind: "country",
      id: "AE",
      alpha2: "AE",
      alpha3: "ARE",
      numeric: "784",
      name: "United Arab Emirates",
    },
  ]);
});

test("emits byte-identical output for the same Snapshots, whatever their order", async () => {
  const reordered: CldrFixture = {
    regular: [...germanyAndAndorra.regular].reverse(),
    codes: [...germanyAndAndorra.codes].reverse(),
    names: [...germanyAndAndorra.names].reverse(),
  };
  expect(await emitCountries(reordered)).toBe(await emitCountries(germanyAndAndorra));
});

test("fails on a duplicate id", async () => {
  await expect(
    buildCountries({ ...germanyAndAndorra, regular: ["DE", "AD", "DE"] }),
  ).rejects.toThrow("Duplicate id DE");
});

test("fails on two Countries sharing an Alpha-3 or Numeric code", async () => {
  const sharing: CldrFixture = {
    ...germanyAndAndorra,
    codes: [
      { type: "DE", numeric: "276", alpha3: "DEU" },
      { type: "AD", numeric: "276", alpha3: "DEU" },
    ],
  };
  await expect(buildCountries(sharing)).rejects.toThrow(
    /Duplicate alpha3 DEU[\s\S]*Duplicate numeric 276/,
  );
});

test.each([
  ["an Alpha-3 code", { type: "DE", numeric: "276", alpha3: "DE" }, /Country DE[\s\S]*alpha3/],
  ["a Numeric code", { type: "DE", numeric: "76", alpha3: "DEU" }, /Country DE[\s\S]*numeric/],
  ["a missing Numeric code", { type: "DE", alpha3: "DEU" }, /Country DE[\s\S]*numeric/],
])("fails on malformed codes: %s", async (_, deCodes, message) => {
  const malformed: CldrFixture = {
    ...germanyAndAndorra,
    codes: [deCodes, { type: "AD", numeric: "020", alpha3: "AND" }],
  };
  await expect(buildCountries(malformed)).rejects.toThrow(message);
});

test("fails on a malformed Alpha-2 code", async () => {
  await expect(
    buildCountries({ ...germanyAndAndorra, regular: ["DE", "AD", "D3"] }),
  ).rejects.toThrow(/Country D3[\s\S]*id/);
});

test("fails on a Country with no English Name", async () => {
  const unnamed: CldrFixture = { ...germanyAndAndorra, names: [{ type: "AD", name: "Andorra" }] };
  await expect(buildCountries(unnamed)).rejects.toThrow(/Country DE[\s\S]*name/);
});

const spain: CldrFixture = {
  regular: ["ES"],
  codes: [{ type: "ES", numeric: "724", alpha3: "ESP" }],
  names: [{ type: "ES", name: "Spain" }],
  subdivisions: {
    regular: ["esal", "esan", "esgr", "esmd"],
    containment: [
      { type: "ES", contains: ["esan", "esmd"] },
      { type: "esan", contains: ["esal", "esgr"] },
    ],
    names: [
      { type: "esal", name: "Almería" },
      { type: "esan", name: "Andalusia" },
      { type: "esgr", name: "Granada" },
      { type: "esmd", name: "Madrid Province" },
    ],
  },
};

async function buildSubdivisions(fixture: CldrFixture, country: string): Promise<unknown> {
  const outDir = await outputDir();
  await build({ sourcesDir: await writeCldrSnapshots(fixture), outDir });
  return JSON.parse(await readFile(join(outDir, "subdivisions", `${country}.json`), "utf8"));
}

test("CLDR containment becomes Parents, including provinces nested under autonomous communities", async () => {
  expect(await buildSubdivisions(spain, "ES")).toEqual([
    {
      kind: "subdivision",
      id: "ES-AL",
      code: "ES-AL",
      country: "ES",
      parent: "ES-AN",
      name: "Almería",
    },
    {
      kind: "subdivision",
      id: "ES-AN",
      code: "ES-AN",
      country: "ES",
      parent: "ES",
      name: "Andalusia",
    },
    {
      kind: "subdivision",
      id: "ES-GR",
      code: "ES-GR",
      country: "ES",
      parent: "ES-AN",
      name: "Granada",
    },
    {
      kind: "subdivision",
      id: "ES-MD",
      code: "ES-MD",
      country: "ES",
      parent: "ES",
      name: "Madrid Province",
    },
  ]);
});

test.each([
  ["a Subdivision CLDR doesn't list as regular", [{ type: "esan", contains: ["esal"] }], "ES-AN"],
  ["a region that isn't a Country", [{ type: "QO", contains: ["esal"] }], "QO"],
])("fails on a Parent that is %s", async (_, containment, parent) => {
  const dangling: CldrFixture = {
    ...spain,
    subdivisions: {
      regular: ["esal"],
      deprecated: ["esan"],
      containment,
      names: [{ type: "esal", name: "Almería" }],
    },
  };
  await expect(buildSubdivisions(dangling, "ES")).rejects.toThrow(
    `Subdivision ES-AL has a dangling Parent ${parent}`,
  );
});

test("fails on a Subdivision code that doesn't start with its Country's Alpha-2 code", async () => {
  const misplaced: CldrFixture = {
    ...spain,
    subdivisions: {
      regular: ["ptlis"],
      containment: [{ type: "ES", contains: ["ptlis"] }],
      names: [{ type: "ptlis", name: "Lisbon" }],
    },
  };
  await expect(buildSubdivisions(misplaced, "ES")).rejects.toThrow(
    "Subdivision PT-LIS doesn't start with its Country's Alpha-2 code ES",
  );
});

test("fails on a Subdivision with no English Name", async () => {
  const unnamed: CldrFixture = {
    ...spain,
    subdivisions: { ...spain.subdivisions!, names: [] },
  };
  await expect(buildSubdivisions(unnamed, "ES")).rejects.toThrow(/Subdivision ES-AL[\s\S]*name/);
});

test("emits one Subdivisions Data pack per Country, empty when it has none", async () => {
  const outDir = await outputDir();
  const fixture: CldrFixture = {
    ...spain,
    regular: ["AD", "ES"],
    codes: [...spain.codes, { type: "AD", numeric: "020", alpha3: "AND" }],
    names: [...spain.names, { type: "AD", name: "Andorra" }],
  };
  await build({ sourcesDir: await writeCldrSnapshots(fixture), outDir });
  const packs = await readdir(join(outDir, "subdivisions"));
  expect(packs.filter((file) => file.endsWith(".json"))).toEqual(["AD.json", "ES.json"]);
  expect(JSON.parse(await readFile(join(outDir, "subdivisions", "AD.json"), "utf8"))).toEqual([]);
});
