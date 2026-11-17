import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { checkAliasChanges } from "../src/alias-changes.ts";
import { outputDir } from "./fixtures.ts";

type AliasFiles = Record<string, Record<string, string[]>>;

/** A Data packs directory holding just the given `*.aliases.json` files. */
async function dataDir(files: AliasFiles): Promise<string> {
  const dir = await outputDir();
  for (const [file, aliases] of Object.entries(files))
    await writeFile(join(dir, file), JSON.stringify(aliases));
  return dir;
}

async function check(before: AliasFiles, after: AliasFiles) {
  const warningPath = join(await outputDir(), "warning.md");
  const changes = await checkAliasChanges({
    beforeDir: await dataDir(before),
    afterDir: await dataDir(after),
    warningPath,
  });
  return { ...changes, warningPath };
}

/** `count` made-up Aliases of AD, numbered from 1. */
function manyAliases(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `Andorra alias ${i + 1}`);
}

test("counts the Aliases a run adds and removes, without flagging a small change", async () => {
  const { added, removed, flagged, warningPath } = await check(
    { "countries.aliases.json": { NL: ["Holland", "Nederland"], DE: ["Deutschland"] } },
    { "countries.aliases.json": { NL: ["Holland", "The Netherlands"], DE: ["Deutschland"] } },
  );
  expect(added).toEqual([{ id: "NL", alias: "The Netherlands" }]);
  expect(removed).toEqual([{ id: "NL", alias: "Nederland" }]);
  expect(flagged).toBe(false);
  await expect(access(warningPath)).rejects.toThrow();
});

test("flags a run that removes more than 20 Aliases more than it adds, listing the removed Aliases", async () => {
  const { removed, flagged, warningPath } = await check(
    {
      "countries.aliases.json": { AD: manyAliases(22) },
      "territories.aliases.json": { XK: ["Kosova"] },
    },
    { "countries.aliases.json": { AD: ["Andorra alias 1", "Principality of Andorra"] } },
  );
  expect(removed).toHaveLength(22);
  expect(flagged).toBe(true);
  const warning = await readFile(warningPath, "utf8");
  expect(warning).toMatch(/^> \[!WARNING\]\n> This run removes 22 Aliases and adds 1\./);
  expect(warning).toContain("> | XK | Kosova |");
  expect(warning).toContain("> | AD | Andorra alias 22 |");
  expect(warning).not.toContain("Andorra alias 1 |");
});

test("does not flag a run whose removals outnumber its additions by exactly 20", async () => {
  const { flagged, warningPath } = await check(
    { "countries.aliases.json": { AD: manyAliases(20) } },
    { "countries.aliases.json": {} },
  );
  expect(flagged).toBe(false);
  await expect(access(warningPath)).rejects.toThrow();
});

test("lists at most 500 removed Aliases, so the warning fits in a PR body", async () => {
  const { warningPath } = await check(
    { "countries.aliases.json": { AD: manyAliases(600) } },
    { "countries.aliases.json": {} },
  );
  const warning = await readFile(warningPath, "utf8");
  expect(warning.match(/^> \| AD \|/gm)).toHaveLength(500);
  expect(warning).toMatch(/> And 100 more; see the build report diff\.\n$/);
});
