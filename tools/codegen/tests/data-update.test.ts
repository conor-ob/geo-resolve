import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { expect, test } from "vite-plus/test";
import {
  assessDataUpdate,
  dataUpdateChangeset,
  dataUpdatePrBody,
  dataUpdateTitle,
  type SnapshotSource,
} from "../src/data-update.ts";
import { outputDir } from "./fixtures.ts";

type DataFiles = Record<string, unknown>;

/** A Data packs directory holding just the given files, by path, written as JSON unless already a string. */
async function dataDir(files: DataFiles): Promise<string> {
  const dir = await outputDir();
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(
      join(dir, path),
      typeof content === "string" ? content : JSON.stringify(content),
    );
  }
  return dir;
}

async function assess(
  before: DataFiles,
  after: DataFiles,
  sources: SnapshotSource[] = ["Wikidata"],
) {
  return assessDataUpdate({
    beforeDir: await dataDir(before),
    afterDir: await dataDir(after),
    sources,
  });
}

/** `count` made-up Aliases of AD, numbered from 1. */
function manyAliases(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `Andorra alias ${i + 1}`);
}

/** No build report or Snapshot changes, for a PR body test about something else. */
const noDiffs = { buildReportDiff: "", snapshotDiff: "" };

const germany = {
  kind: "country",
  id: "DE",
  alpha2: "DE",
  alpha3: "DEU",
  numeric: "276",
  name: "Germany",
};

test("counts the Aliases a run adds and removes, without flagging a small change", async () => {
  const { aliases } = await assess(
    { "countries.aliases.json": { NL: ["Holland", "Nederland"], DE: ["Deutschland"] } },
    { "countries.aliases.json": { NL: ["Holland", "The Netherlands"], DE: ["Deutschland"] } },
  );
  expect(aliases).toEqual({
    added: [{ id: "NL", alias: "The Netherlands" }],
    removed: [{ id: "NL", alias: "Nederland" }],
    flagged: false,
  });
});

test("flags a run that removes more than 20 Aliases more than it adds, and gives it no changeset", async () => {
  const update = await assess(
    {
      "countries.aliases.json": { AD: manyAliases(22) },
      "territories.aliases.json": { XK: ["Kosova"] },
    },
    { "countries.aliases.json": { AD: ["Andorra alias 1", "Principality of Andorra"] } },
  );
  expect(update.aliases.removed).toHaveLength(22);
  expect(update.aliases.flagged).toBe(true);
  expect(dataUpdateChangeset(update)).toBeNull();
  const body = dataUpdatePrBody(update, noDiffs);
  expect(body).toMatch(/^> \[!WARNING\]\n> This run removes 22 Aliases and adds 1\./);
  expect(body).toContain("> | XK | Kosova |");
  expect(body).toContain("> | AD | Andorra alias 22 |");
  expect(body).not.toContain("Andorra alias 1 |");
  expect(body).toContain("> So this PR adds no changeset");
  expect(body).not.toContain("It adds a");
});

test("does not flag a run whose removals outnumber its additions by exactly 20", async () => {
  const update = await assess(
    { "countries.aliases.json": { AD: manyAliases(20) } },
    { "countries.aliases.json": {} },
  );
  expect(update.aliases.flagged).toBe(false);
  expect(dataUpdatePrBody(update, noDiffs)).not.toContain("[!WARNING]");
});

test("lists at most 500 removed Aliases, so the warning fits in a PR body", async () => {
  const update = await assess(
    { "countries.aliases.json": { AD: manyAliases(600) } },
    { "countries.aliases.json": {} },
  );
  const body = dataUpdatePrBody(update, noDiffs);
  expect(body.match(/^> \| AD \|/gm)).toHaveLength(500);
  expect(body).toContain("> And 100 more; see the build report diff.\n");
});

test.each<[string, DataFiles, DataFiles, "patch" | "minor" | null]>([
  ["nothing changed", { "countries.json": [germany] }, { "countries.json": [germany] }, null],
  [
    "only Aliases changed",
    { "countries.aliases.json": { DE: ["Deutschland"] } },
    { "countries.aliases.json": { DE: ["Deutschland", "BRD"] } },
    "patch",
  ],
  [
    "only a Name changed, a correction under ADR-0007",
    { "countries.json": [germany] },
    { "countries.json": [{ ...germany, name: "Federal Republic of Germany" }] },
    "patch",
  ],
  [
    "a code changed",
    { "countries.json": [germany] },
    { "countries.json": [{ ...germany, codes: { ioc: "GER" } }] },
    "minor",
  ],
  [
    "an Entity was added",
    { "countries.json": [germany] },
    { "countries.json": [germany, { ...germany, id: "DD", alpha2: "DD", name: "East Germany" }] },
    "minor",
  ],
  ["a Data pack file was added", {}, { "subdivisions/DE.json": [] }, "minor"],
  [
    "a former code changed",
    { "countries.former-codes.json": {} },
    { "countries.former-codes.json": { DE: { alpha3: ["FRG"] } } },
    "minor",
  ],
  [
    "only a generated module changed",
    { "known-codes.ts": "export type A = 1;" },
    { "known-codes.ts": "export type A = 2;" },
    null,
  ],
])("the bump is right when %s", async (_, before, after, bump) => {
  const update = await assess(before, after);
  expect(update.bump).toBe(bump);
  const changeset = dataUpdateChangeset(update);
  if (bump === null) expect(changeset).toBeNull();
  else
    expect(
      changeset?.startsWith(
        `---\n"geo-resolve": ${bump}\n---\n\nUpdate the data from the latest Wikidata Snapshot.\n`,
      ),
    ).toBe(true);
});

test("the changeset names the Aliases a run adds and removes", async () => {
  const update = await assess(
    { "countries.aliases.json": { NL: ["Holland", "Nederland"], DE: ["Deutschland"] } },
    { "countries.aliases.json": { NL: ["Holland", "Olanda"], DE: ["BRD", "Deutschland"] } },
  );
  expect(dataUpdateChangeset(update)).toBe(
    [
      "---",
      '"geo-resolve": patch',
      "---",
      "",
      "Update the data from the latest Wikidata Snapshot.",
      "",
      '- Adds 2 Aliases: "BRD" (DE) and "Olanda" (NL).',
      '- Removes 1 Alias: "Nederland" (NL).',
      "",
    ].join("\n"),
  );
});

test("the changeset names at most 20 added Aliases, and only says what else changed when no Alias did", async () => {
  const many = await assess(
    { "countries.aliases.json": {} },
    { "countries.aliases.json": { AD: manyAliases(23) } },
  );
  const changeset = dataUpdateChangeset(many) ?? "";
  expect(changeset).toContain('- Adds 23 Aliases: "Andorra alias 1" (AD), ');
  expect(changeset.match(/" \(AD\)/g)).toHaveLength(20);
  expect(changeset).toContain(" and 3 more.\n");
  expect(changeset).not.toContain("Removes");
  const nameOnly = await assess(
    { "countries.json": [germany] },
    { "countries.json": [{ ...germany, name: "Federal Republic of Germany" }] },
  );
  expect(dataUpdateChangeset(nameOnly)).toMatch(/Wikidata Snapshot\.\n$/);
});

test.each<[SnapshotSource[], string, string]>([
  [["CLDR"], "CLDR Snapshot", "chore(data): update snapshots from cldr"],
  [["Wikidata"], "Wikidata Snapshot", "chore(data): update snapshots from wikidata"],
  [
    ["Wikidata", "CLDR"],
    "CLDR and Wikidata Snapshots",
    "chore(data): update snapshots from cldr and wikidata",
  ],
  [[], "Snapshots", "chore(data): update snapshots"],
])("names only the Sources whose Snapshots changed: %j", async (sources, label, title) => {
  const update = await assess(
    { "countries.aliases.json": {} },
    { "countries.aliases.json": { DE: ["BRD"] } },
    sources,
  );
  expect(dataUpdateChangeset(update)).toContain(`from the latest ${label}.`);
  expect(dataUpdatePrBody(update, noDiffs)).toContain(`upstream changes in the ${label}.`);
  expect(dataUpdateTitle(update)).toBe(title);
});

test("the PR body points reviewers at ADR-0013, states the bump and shows the build report diff", async () => {
  const update = await assess(
    { "countries.aliases.json": {} },
    { "countries.aliases.json": { DE: ["BRD"] } },
  );
  const body = dataUpdatePrBody(update, { ...noDiffs, buildReportDiff: "-old\n+new\n" });
  expect(body).toContain(
    "not for their language: a foreign name in an English Locale is kept (ADR-0013)",
  );
  expect(body).toContain("It adds a patch changeset.");
  expect(body).toContain("## Build report diff\n\n````diff\n-old\n+new\n````\n");
  expect(dataUpdatePrBody(update, noDiffs)).toContain("The build report is unchanged.");
  expect(
    dataUpdatePrBody(update, { ...noDiffs, buildReportDiff: `+${"x".repeat(60_001)}\n` }),
  ).toContain("The diff is too long to show here");
});

/** A `git diff` of one Snapshot file, changing the rank on NL's Alpha-2 statement on Q55. */
const rankDiff = [
  "diff --git a/tools/codegen/sources/wikidata/items.json b/tools/codegen/sources/wikidata/items.json",
  "index 170a172..30cb7d7 100644",
  "--- a/tools/codegen/sources/wikidata/items.json",
  "+++ b/tools/codegen/sources/wikidata/items.json",
  "@@ -191,1 +191,1 @@",
  '-{"item":"Q55","alpha2":"NL","rank":"DeprecatedRank"},',
  '+{"item":"Q55","alpha2":"NL","rank":"NormalRank"},',
  "",
].join("\n");

test("the PR body shows the Snapshot changes the build report doesn't, folded", async () => {
  const update = await assess({ "countries.json": [germany] }, { "countries.json": [germany] });
  const body = dataUpdatePrBody(update, { buildReportDiff: "", snapshotDiff: rankDiff });
  expect(body).toContain("The build report is unchanged.\n\n## Snapshot changes\n\n");
  expect(body).toContain("| `tools/codegen/sources/wikidata/items.json` | 1 | 1 |\n");
  expect(body).toContain(
    "<details>\n<summary>Snapshot diff</summary>\n\n````diff\ndiff --git a/tools/codegen/sources/wikidata/items.json",
  );
  expect(body).toContain(
    '+{"item":"Q55","alpha2":"NL","rank":"NormalRank"},\n````\n\n</details>\n',
  );
  expect(dataUpdatePrBody(update, noDiffs)).not.toContain("## Snapshot changes");
});

test("the PR body counts each Snapshot file's lines, and leaves out a Snapshot diff too long for it", async () => {
  const update = await assess({ "countries.json": [germany] }, { "countries.json": [germany] });
  const cldrDiff = [
    "diff --git a/tools/codegen/sources/cldr/territories.json b/tools/codegen/sources/cldr/territories.json",
    "--- a/tools/codegen/sources/cldr/territories.json",
    "+++ b/tools/codegen/sources/cldr/territories.json",
    "@@ -1,1 +1,3 @@",
    ` ${"x".repeat(60_000)}`,
    "+a",
    "+b",
    "",
  ].join("\n");
  const body = dataUpdatePrBody(update, { buildReportDiff: "", snapshotDiff: rankDiff + cldrDiff });
  expect(body).toContain(
    "| `tools/codegen/sources/wikidata/items.json` | 1 | 1 |\n| `tools/codegen/sources/cldr/territories.json` | 2 | 0 |\n",
  );
  expect(body).not.toContain("<details>");
  expect(body).toContain(
    "The diff is too long to show here; see `tools/codegen/sources` in the changed files.",
  );
  expect(body.length).toBeLessThan(65_536);
});
