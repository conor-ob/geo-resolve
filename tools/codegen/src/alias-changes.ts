import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * How many more Aliases a data update may remove than it adds before it is flagged. A correction removes a few; a mass
 * one-sided removal is much more likely an upstream or query artefact than the correction a patch release is for
 * (ADR-0007), so a person checks it and chooses the release bump.
 */
export const ALIAS_REMOVAL_THRESHOLD = 20;

/** How many removed Aliases a warning lists, so it fits in a PR body with room for the build report diff. */
const MAX_LISTED_REMOVALS = 500;

/** An Alias of the Entity with this id. */
export interface EntityAlias {
  id: string;
  alias: string;
}

/** The Aliases a data update adds and removes, and whether the removals are enough to flag it. */
export interface AliasChanges {
  added: EntityAlias[];
  removed: EntityAlias[];
  flagged: boolean;
}

/** Every Alias in the `*.aliases.json` files of a Data packs directory, keyed by `id` and Alias. */
async function readAliases(dataDir: string): Promise<Map<string, EntityAlias>> {
  const aliases = new Map<string, EntityAlias>();
  for (const file of (await readdir(dataDir)).filter((name) => name.endsWith(".aliases.json"))) {
    const byId = JSON.parse(await readFile(join(dataDir, file), "utf8")) as Record<
      string,
      string[]
    >;
    for (const [id, entityAliases] of Object.entries(byId))
      for (const alias of entityAliases) aliases.set(`${id}\t${alias}`, { id, alias });
  }
  return aliases;
}

function missingFrom(
  from: ReadonlyMap<string, EntityAlias>,
  other: ReadonlyMap<string, EntityAlias>,
): EntityAlias[] {
  return [...from].filter(([key]) => !other.has(key)).map(([, alias]) => alias);
}

function byIdAndAlias(a: EntityAlias, b: EntityAlias): number {
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return a.alias < b.alias ? -1 : a.alias > b.alias ? 1 : 0;
}

/** A Markdown warning, as a GitHub alert, that lists the removed Aliases. */
function removalWarning(added: readonly EntityAlias[], removed: readonly EntityAlias[]): string {
  const cell = (text: string) => text.replaceAll("|", "\\|");
  return [
    "[!WARNING]",
    `This run removes ${removed.length} Aliases and adds ${added.length}. More than ${ALIAS_REMOVAL_THRESHOLD} one-sided removals is much more likely an upstream or query artefact than a correction, so check them before merging.`,
    "",
    "| Entity | Removed Alias |",
    "| --- | --- |",
    ...removed
      .slice(0, MAX_LISTED_REMOVALS)
      .map(({ id, alias }) => `| ${cell(id)} | ${cell(alias)} |`),
    ...(removed.length > MAX_LISTED_REMOVALS
      ? ["", `And ${removed.length - MAX_LISTED_REMOVALS} more; see the build report diff.`]
      : []),
  ]
    .map((line) => (line === "" ? ">" : `> ${line}`))
    .join("\n")
    .concat("\n");
}

/**
 * Compares the Aliases of two Data packs directories, from before and after a data update. When the update removes
 * more than {@link ALIAS_REMOVAL_THRESHOLD} Aliases more than it adds, it is flagged and a warning listing the removed
 * Aliases is written to `warningPath`; otherwise nothing is written.
 */
export async function checkAliasChanges({
  beforeDir,
  afterDir,
  warningPath,
}: {
  beforeDir: string;
  afterDir: string;
  warningPath: string;
}): Promise<AliasChanges> {
  const before = await readAliases(beforeDir);
  const after = await readAliases(afterDir);
  const added = missingFrom(after, before).sort(byIdAndAlias);
  const removed = missingFrom(before, after).sort(byIdAndAlias);
  const flagged = removed.length - added.length > ALIAS_REMOVAL_THRESHOLD;
  if (flagged) await writeFile(warningPath, removalWarning(added, removed));
  return { added, removed, flagged };
}
