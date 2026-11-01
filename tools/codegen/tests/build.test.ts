import { readFile } from "node:fs/promises";
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

async function buildCountries(fixture: CldrFixture): Promise<unknown> {
  const outDir = await outputDir();
  await build({ sourcesDir: await writeCldrSnapshots(fixture), outDir });
  return JSON.parse(await readFile(join(outDir, "countries.json"), "utf8"));
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
  const emit = async (fixture: CldrFixture) => {
    const outDir = await outputDir();
    await build({ sourcesDir: await writeCldrSnapshots(fixture), outDir });
    return readFile(join(outDir, "countries.json"), "utf8");
  };
  expect(await emit(reordered)).toBe(await emit(germanyAndAndorra));
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
