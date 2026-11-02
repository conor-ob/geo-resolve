import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { build } from "../src/build.ts";
import { outputDir, writeCldrSnapshots, writeOverlay, type CldrFixture } from "./fixtures.ts";

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
  await build({
    sourcesDir: await writeCldrSnapshots(fixture),
    overlayPath: await writeOverlay(),
    outDir,
  });
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
  await build({
    sourcesDir: await writeCldrSnapshots(fixture),
    overlayPath: await writeOverlay(),
    outDir,
  });
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
  ["a CLDR region that isn't a Country", [{ type: "QO", contains: ["esal"] }], "QO"],
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
  await build({
    sourcesDir: await writeCldrSnapshots(fixture),
    overlayPath: await writeOverlay(),
    outDir,
  });
  const packs = await readdir(join(outDir, "subdivisions"));
  expect(packs.filter((file) => file.endsWith(".json"))).toEqual(["AD.json", "ES.json"]);
  expect(JSON.parse(await readFile(join(outDir, "subdivisions", "AD.json"), "utf8"))).toEqual([]);
});

test("emits the Known code unions, sorted, as a module outside semver", async () => {
  const outDir = await outputDir();
  const fixture: CldrFixture = {
    ...spain,
    regular: ["ES", "AD"],
    codes: [...spain.codes, { type: "AD", numeric: "020", alpha3: "AND" }],
    names: [...spain.names, { type: "AD", name: "Andorra" }],
  };
  await build({
    sourcesDir: await writeCldrSnapshots(fixture),
    overlayPath: await writeOverlay(),
    outDir,
  });
  expect(await readFile(join(outDir, "known-codes.ts"), "utf8")).toBe(`\
// Generated by \`@geo-resolve/codegen build\` from the Snapshots. Do not edit.

/**
 * The Alpha-2 code of every Country in this release.
 * Not covered by semver: a data release may add or withdraw codes (ADR-0006).
 * @beta
 */
export type KnownAlpha2 =
  | "AD"
  | "ES";

/**
 * The Alpha-3 code of every Country in this release.
 * Not covered by semver: a data release may add or withdraw codes (ADR-0006).
 * @beta
 */
export type KnownAlpha3 =
  | "AND"
  | "ESP";

/**
 * The Subdivision code of every Subdivision in this release.
 * Not covered by semver: a data release may add or withdraw codes (ADR-0006).
 * @beta
 */
export type KnownSubdivisionCode =
  | "ES-AL"
  | "ES-AN"
  | "ES-GR"
  | "ES-MD";
`);
});

test("fails on a Subdivision CLDR lists under two Parents", async () => {
  const twice: CldrFixture = {
    ...spain,
    subdivisions: {
      ...spain.subdivisions!,
      containment: [...spain.subdivisions!.containment, { type: "ES", contains: ["esal"] }],
    },
  };
  await expect(buildSubdivisions(twice, "ES")).rejects.toThrow(
    "Subdivision ES-AL has two Parents, ES-AN and ES",
  );
});

test("fails on Parents that form a cycle", async () => {
  const cyclic: CldrFixture = {
    ...spain,
    subdivisions: {
      regular: ["esal", "esan"],
      containment: [
        { type: "esan", contains: ["esal"] },
        { type: "esal", contains: ["esan"] },
      ],
      names: spain.subdivisions!.names,
    },
  };
  await expect(buildSubdivisions(cyclic, "ES")).rejects.toThrow(
    "Subdivision ES-AL has Parents that form a cycle",
  );
});

const serbiaAndMontenegro: CldrFixture = {
  regular: ["ME", "RS"],
  codes: [
    { type: "ME", numeric: "499", alpha3: "MNE" },
    { type: "RS", numeric: "688", alpha3: "SRB" },
  ],
  names: [
    { type: "ME", name: "Montenegro" },
    { type: "RS", name: "Serbia" },
  ],
};

const yugoslavia = {
  alpha4: "YUCS",
  alpha2: "YU",
  alpha3: "YUG",
  numeric: "891",
  name: "Yugoslavia",
  withdrawn: "2003-07-23",
  successors: ["CSXX"],
  citation: "https://www.iso.org/obp/ui/#iso:code:3166:YU",
};

const csxx = {
  alpha4: "CSXX",
  alpha2: "CS",
  alpha3: "SCG",
  numeric: "891",
  name: "Serbia and Montenegro",
  withdrawn: "2006-09-26",
  successors: ["RS", "ME"],
  citation: "https://www.iso.org/obp/ui/#iso:code:3166:CS",
};

async function buildWithOverlay(
  overlay: unknown,
  fixture: CldrFixture = serbiaAndMontenegro,
): Promise<string> {
  const outDir = await outputDir();
  await build({
    sourcesDir: await writeCldrSnapshots(fixture),
    overlayPath: await writeOverlay(overlay),
    outDir,
  });
  return outDir;
}

async function readPack(outDir: string, file: string): Promise<unknown> {
  return JSON.parse(await readFile(join(outDir, file), "utf8"));
}

test("Historic countries pass through from the Overlay, sorted by id, without their citations", async () => {
  const outDir = await buildWithOverlay({ historicCountries: [yugoslavia, csxx] });
  expect(await readPack(outDir, "historic-countries.json")).toEqual([
    {
      kind: "historic-country",
      id: "CSXX",
      alpha4: "CSXX",
      alpha2: "CS",
      alpha3: "SCG",
      numeric: "891",
      name: "Serbia and Montenegro",
      withdrawn: "2006-09-26",
      successors: ["ME", "RS"],
    },
    {
      kind: "historic-country",
      id: "YUCS",
      alpha4: "YUCS",
      alpha2: "YU",
      alpha3: "YUG",
      numeric: "891",
      name: "Yugoslavia",
      withdrawn: "2003-07-23",
      successors: ["CSXX"],
    },
  ]);
});

test("fails on a Successor that doesn't resolve to an Entity", async () => {
  await expect(buildWithOverlay({ historicCountries: [yugoslavia] })).rejects.toThrow(
    "Historic country YUCS has a dangling Successor CSXX",
  );
});

test("fails on a Historic country that doesn't cite its ISO source", async () => {
  const { citation: _, ...uncited } = csxx;
  await expect(buildWithOverlay({ historicCountries: [uncited] })).rejects.toThrow(
    /Overlay is malformed[\s\S]*historicCountries\[0\]\.citation/,
  );
});

test("fails on a malformed withdrawal date", async () => {
  await expect(
    buildWithOverlay({ historicCountries: [{ ...csxx, withdrawn: "26 September 2006" }] }),
  ).rejects.toThrow(/Overlay is malformed[\s\S]*withdrawn/);
});

test("fails on two Historic countries sharing an Alpha-4 code", async () => {
  await expect(buildWithOverlay({ historicCountries: [csxx, csxx] })).rejects.toThrow(
    "Duplicate id CSXX",
  );
});

const romania: CldrFixture = {
  regular: ["RO"],
  codes: [{ type: "RO", numeric: "642", alpha3: "ROU" }],
  names: [{ type: "RO", name: "Romania" }],
};

const rom = {
  country: "RO",
  code: "ROM",
  citation: "https://www.iso.org/obp/ui/#iso:code:3166:RO",
};

test("a former code becomes an Alias of its Country, not a Historic country or a field", async () => {
  const outDir = await buildWithOverlay({ formerCodes: [rom] }, romania);
  expect(await readPack(outDir, "countries.aliases.json")).toEqual({ RO: ["ROM"] });
  expect(await readPack(outDir, "countries.json")).toEqual([
    { kind: "country", id: "RO", alpha2: "RO", alpha3: "ROU", numeric: "642", name: "Romania" },
  ]);
  expect(await readPack(outDir, "historic-countries.json")).toEqual([]);
});

test("a Historic country's ISO formal name is an Alias, not its Name", async () => {
  const ussr = {
    alpha4: "SUHH",
    alpha2: "SU",
    alpha3: "SUN",
    numeric: "810",
    name: "Soviet Union",
    aliases: ["USSR, Union of Soviet Socialist Republics", "USSR"],
    withdrawn: "1992",
    successors: ["RU"],
    citation: "https://www.iso.org/obp/ui/#iso:code:3166:SU",
  };
  const russia: CldrFixture = {
    regular: ["RU"],
    codes: [{ type: "RU", numeric: "643", alpha3: "RUS" }],
    names: [{ type: "RU", name: "Russia" }],
  };
  const outDir = await buildWithOverlay({ historicCountries: [ussr] }, russia);
  expect(await readPack(outDir, "historic-countries.aliases.json")).toEqual({
    SUHH: ["USSR", "USSR, Union of Soviet Socialist Republics"],
  });
  expect(await readPack(outDir, "historic-countries.json")).toEqual([
    expect.objectContaining({ id: "SUHH", name: "Soviet Union", withdrawn: "1992" }),
  ]);
});

test("fails on a withdrawal date that isn't a real date", async () => {
  await expect(
    buildWithOverlay({ historicCountries: [{ ...csxx, withdrawn: "2006-13-45" }] }),
  ).rejects.toThrow(/Overlay is malformed[\s\S]*withdrawn/);
});

test("fails on a Historic country that lists a Successor twice or succeeds itself", async () => {
  await expect(
    buildWithOverlay({ historicCountries: [{ ...csxx, successors: ["RS", "RS", "CSXX"] }] }),
  ).rejects.toThrow(
    /Historic country CSXX is its own Successor[\s\S]*Historic country CSXX lists Successor RS twice/,
  );
});

// CLDR deprecates `uspr` because PR has its own region code; ISO still lists both.
const puertoRico: CldrFixture = {
  regular: ["PR", "US"],
  codes: [
    { type: "PR", numeric: "630", alpha3: "PRI" },
    { type: "US", numeric: "840", alpha3: "USA" },
  ],
  names: [
    { type: "PR", name: "Puerto Rico" },
    { type: "US", name: "United States" },
  ],
  subdivisions: {
    regular: ["usca"],
    deprecated: ["uspr"],
    containment: [{ type: "US", contains: ["usca", "uspr"] }],
    names: [
      { type: "usca", name: "California" },
      { type: "uspr", name: "Puerto Rico" },
    ],
  },
};

const prSameAs = {
  entities: ["PR", "US-PR"],
  citation: "https://www.iso.org/obp/ui/#iso:code:3166:PR",
};

test("a Same-as link from the Overlay is written on both sides, admitting the Subdivision CLDR deprecates", async () => {
  const outDir = await buildWithOverlay({ sameAs: [prSameAs] }, puertoRico);
  expect(await readPack(outDir, "countries.json")).toEqual([
    {
      kind: "country",
      id: "PR",
      alpha2: "PR",
      alpha3: "PRI",
      numeric: "630",
      name: "Puerto Rico",
      sameAs: ["US-PR"],
    },
    {
      kind: "country",
      id: "US",
      alpha2: "US",
      alpha3: "USA",
      numeric: "840",
      name: "United States",
    },
  ]);
  expect(await readPack(outDir, "subdivisions/US.json")).toEqual([
    {
      kind: "subdivision",
      id: "US-CA",
      code: "US-CA",
      country: "US",
      parent: "US",
      name: "California",
    },
    {
      kind: "subdivision",
      id: "US-PR",
      code: "US-PR",
      country: "US",
      parent: "US",
      name: "Puerto Rico",
      sameAs: ["PR"],
    },
  ]);
});

// CLDR deprecates `shta` because TA has its own region code, though TA isn't a Country; `shxx` stands for a code ISO withdrew.
const saintHelena: CldrFixture = {
  regular: ["SH"],
  codes: [{ type: "SH", numeric: "654", alpha3: "SHN" }],
  names: [{ type: "SH", name: "St. Helena" }],
  subdivisions: {
    regular: ["shhl"],
    deprecated: ["shta", "shxx"],
    containment: [{ type: "SH", contains: ["shhl", "shta"] }],
    names: [
      { type: "shhl", name: "Saint Helena" },
      { type: "shta", name: "Tristan da Cunha" },
      { type: "shxx", name: "Withdrawn" },
    ],
  },
};

test("a Subdivision code CLDR deprecates but still lists in containment is built, with or without a Same-as link", async () => {
  const outDir = await buildWithOverlay({}, saintHelena);
  expect(await readPack(outDir, "subdivisions/SH.json")).toEqual([
    expect.objectContaining({ id: "SH-HL" }),
    {
      kind: "subdivision",
      id: "SH-TA",
      code: "SH-TA",
      country: "SH",
      parent: "SH",
      name: "Tristan da Cunha",
    },
  ]);
});

test.each([
  [
    "a Subdivision that isn't built",
    ["PR", "US-GU"],
    "Same-as link PR ↔ US-GU has a dangling Entity US-GU",
  ],
  [
    "a Country that isn't built",
    ["GU", "US-PR"],
    "Same-as link GU ↔ US-PR has a dangling Entity GU",
  ],
])("fails on a Same-as link to %s", async (_, entities, message) => {
  await expect(
    buildWithOverlay({ sameAs: [{ ...prSameAs, entities }] }, puertoRico),
  ).rejects.toThrow(message);
});

test("fails on a Same-as link that doesn't cite its ISO source", async () => {
  const { citation: _, ...uncited } = prSameAs;
  await expect(buildWithOverlay({ sameAs: [uncited] }, puertoRico)).rejects.toThrow(
    /Overlay is malformed[\s\S]*sameAs\[0\]\.citation/,
  );
});

test("fails on a Same-as link that is listed twice", async () => {
  await expect(buildWithOverlay({ sameAs: [prSameAs, prSameAs] }, puertoRico)).rejects.toThrow(
    "Same-as link PR ↔ US-PR is listed twice",
  );
});

test.each([
  ["two Countries", ["PR", "US"]],
  ["two Subdivisions", ["US-CA", "US-PR"]],
  ["a Subdivision and a Country", ["US-PR", "PR"]],
])(
  "fails on a Same-as link that joins %s, not a Country and a Subdivision",
  async (_, entities) => {
    await expect(
      buildWithOverlay({ sameAs: [{ ...prSameAs, entities }] }, puertoRico),
    ).rejects.toThrow(/Overlay is malformed[\s\S]*sameAs\[0\]\.entities/);
  },
);

const isoSpain = "https://www.iso.org/obp/ui/#iso:code:3166:ES";

test("an Overlay Parent correction overrides the Parent CLDR gives a Subdivision", async () => {
  const overlay = { parents: [{ subdivision: "ES-GR", parent: "ES", citation: isoSpain }] };
  const outDir = await buildWithOverlay(overlay, spain);
  const subdivisions = (await readPack(outDir, "subdivisions/ES.json")) as { id: string }[];
  expect(subdivisions.find(({ id }) => id === "ES-GR")).toMatchObject({ parent: "ES" });
  expect(subdivisions.find(({ id }) => id === "ES-AL")).toMatchObject({ parent: "ES-AN" });
});

test.each([
  [
    "a Subdivision CLDR doesn't list",
    { subdivision: "ES-XX", parent: "ES", citation: isoSpain },
    "Parent correction for ES-XX has a dangling Subdivision",
  ],
  [
    "a Parent that isn't an Entity",
    { subdivision: "ES-GR", parent: "ES-XX", citation: isoSpain },
    "Subdivision ES-GR has a dangling Parent ES-XX",
  ],
  [
    "a Parent CLDR already gives",
    { subdivision: "ES-GR", parent: "ES-AN", citation: isoSpain },
    "Parent correction for ES-GR matches CLDR, so it is no longer needed",
  ],
])("fails on a Parent correction for %s", async (_, correction, message) => {
  await expect(buildWithOverlay({ parents: [correction] }, spain)).rejects.toThrow(message);
});

test("fails on a Parent correction that doesn't cite its ISO source", async () => {
  await expect(
    buildWithOverlay({ parents: [{ subdivision: "ES-GR", parent: "ES" }] }, spain),
  ).rejects.toThrow(/Overlay is malformed[\s\S]*citation/);
});

test("fails on two Parent corrections for one Subdivision", async () => {
  const correction = { subdivision: "ES-GR", parent: "ES", citation: isoSpain };
  await expect(
    buildWithOverlay({ parents: [correction, { ...correction, parent: "ES-MD" }] }, spain),
  ).rejects.toThrow("Subdivision ES-GR has two Parent corrections");
});
