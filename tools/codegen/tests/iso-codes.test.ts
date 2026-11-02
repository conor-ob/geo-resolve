import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { build } from "../src/build.ts";
import { compareWithIsoCodes, type IsoCodes } from "../src/iso-codes.ts";
import { outputDir, writeCldrSnapshots, writeOverlay, type CldrFixture } from "./fixtures.ts";

// Every record here is made up for the test; none is copied from iso-codes.
const spain: CldrFixture = {
  regular: ["ES"],
  codes: [{ type: "ES", numeric: "724", alpha3: "ESP" }],
  names: [{ type: "ES", name: "Spain" }],
  subdivisions: {
    regular: ["esal", "esan"],
    containment: [
      { type: "ES", contains: ["esan"] },
      { type: "esan", contains: ["esal"] },
    ],
    names: [
      { type: "esal", name: "Almería" },
      { type: "esan", name: "Andalusia" },
    ],
  },
};

const oldSpain = {
  alpha4: "SPES",
  alpha2: "SP",
  alpha3: "SPN",
  name: "Old Spain",
  aliases: ["Old Spain, Kingdom of"],
  withdrawn: "1990",
  successors: ["ES"],
  citation: "https://www.iso.org/obp/ui/#iso:code:3166:SPES",
};

/** iso-codes as it would read for the fixtures, before a test changes it. */
function matchingIsoCodes(): {
  "3166-1": { "3166-1": Record<string, string>[] };
  "3166-2": { "3166-2": Record<string, string>[] };
  "3166-3": { "3166-3": Record<string, string>[] };
} {
  return {
    "3166-1": {
      "3166-1": [
        {
          alpha_2: "ES",
          alpha_3: "ESP",
          numeric: "724",
          name: "Spain",
          official_name: "Kingdom of Spain",
        },
      ],
    },
    "3166-2": {
      "3166-2": [
        { code: "ES-AL", name: "Almería", parent: "ES-AN", type: "Province" },
        { code: "ES-AN", name: "Andalusia", type: "Autonomous community" },
      ],
    },
    "3166-3": {
      "3166-3": [
        {
          alpha_4: "SPES",
          alpha_2: "SP",
          alpha_3: "SPN",
          name: "Old Spain, Kingdom of",
          withdrawal_date: "1990-01-01",
        },
      ],
    },
  };
}

async function compare(isoCodes: IsoCodes, allowlist: unknown = { differences: [] }) {
  const dataDir = await outputDir();
  await build({
    sourcesDir: await writeCldrSnapshots(spain),
    overlayPath: await writeOverlay({ historicCountries: [oldSpain] }),
    outDir: dataDir,
  });
  const dir = await mkdtemp(join(tmpdir(), "geo-resolve-allowlist-"));
  const allowlistPath = join(dir, "allowlist.json");
  await writeFile(allowlistPath, JSON.stringify(allowlist));
  return compareWithIsoCodes({ dataDir, isoCodes, allowlistPath });
}

test("passes when codes, Names, Parents and Historic countries agree with iso-codes", async () => {
  await expect(compare(matchingIsoCodes())).resolves.toBeUndefined();
});

test("a year-only withdrawal date agrees only with a full date in that year", async () => {
  // The passing case above relies on 1990 agreeing with 1990-01-01, and on Old Spain's ISO name being its Alias.
  const iso = matchingIsoCodes();
  iso["3166-3"]["3166-3"][0]!.withdrawal_date = "1991-01-01";
  await expect(compare(iso)).rejects.toThrow(
    'SPES withdrawn differs: ours "1990", iso-codes "1991-01-01"',
  );
});

test("fails on a Parent that differs from iso-codes, as when CLDR lags a move", async () => {
  const iso = matchingIsoCodes();
  iso["3166-2"]["3166-2"][0]!.parent = "ES-XX";
  await expect(compare(iso)).rejects.toThrow(
    'ES-AL parent differs: ours "ES-AN", iso-codes "ES-XX"',
  );
});

test("a Subdivision iso-codes gives no Parent sits directly under its Country", async () => {
  const iso = matchingIsoCodes();
  iso["3166-2"]["3166-2"][0]!.parent = "ES";
  await expect(compare(iso)).rejects.toThrow('ES-AL parent differs: ours "ES-AN", iso-codes "ES"');
});

test("fails on codes and Names that differ", async () => {
  const iso = matchingIsoCodes();
  Object.assign(iso["3166-1"]["3166-1"][0]!, { alpha_3: "ESX", numeric: "999", name: "España" });
  await expect(compare(iso)).rejects.toThrow(
    /ES alpha3 differs[\s\S]*ES numeric differs[\s\S]*ES name differs/,
  );
});

test("fails on an Entity found on only one side", async () => {
  const iso = matchingIsoCodes();
  iso["3166-2"]["3166-2"] = [
    iso["3166-2"]["3166-2"][1]!,
    { code: "ES-ZZ", name: "Nowhere", parent: "ES-AN" },
  ];
  await expect(compare(iso)).rejects.toThrow(
    /ES-AL is not in iso-codes[\s\S]*ES-ZZ is missing from our data/,
  );
});

test("passes on a difference the allowlist lists with a reason", async () => {
  const iso = matchingIsoCodes();
  iso["3166-2"]["3166-2"][1]!.name = "Andalucía";
  const allowlist = {
    differences: [{ field: "name", reason: "CLDR uses the English exonym", ids: ["ES-AN"] }],
  };
  await expect(compare(iso, allowlist)).resolves.toBeUndefined();
});

test("fails on an allowlist entry that no longer matches a difference", async () => {
  const allowlist = {
    differences: [{ field: "name", reason: "CLDR uses the English exonym", ids: ["ES-AN"] }],
  };
  await expect(compare(matchingIsoCodes(), allowlist)).rejects.toThrow(
    "Allowlist lists the name of ES-AN, which no longer differs",
  );
});

test("fails on an allowlist entry with no reason", async () => {
  const allowlist = { differences: [{ field: "name", reason: "", ids: ["ES-AN"] }] };
  await expect(compare(matchingIsoCodes(), allowlist)).rejects.toThrow(
    /Allowlist is malformed[\s\S]*reason/,
  );
});

test("fails on malformed iso-codes data", async () => {
  const iso = matchingIsoCodes();
  delete (iso["3166-2"]["3166-2"][0] as Partial<Record<string, string>>).code;
  await expect(compare(iso)).rejects.toThrow(/iso-codes 3166-2 is malformed[\s\S]*code/);
});
