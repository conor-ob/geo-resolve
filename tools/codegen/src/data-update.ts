import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

/**
 * How many more Aliases a data update may remove than it adds before it is flagged. A correction removes a few; a mass
 * one-sided removal is much more likely an upstream or query artefact than the correction a patch release is for
 * (ADR-0007), so a person checks it and chooses the release bump.
 */
export const ALIAS_REMOVAL_THRESHOLD = 20;

/** How many removed Aliases a warning lists, so it fits in a PR body with room for the build report diff. */
const MAX_LISTED_REMOVALS = 500;

/** GitHub caps a PR body at 65536 characters; this leaves room for the text around the build report diff. */
const MAX_BODY_DIFF = 60_000;

/** The Sources whose Snapshots a data update can change. */
export const SNAPSHOT_SOURCES = ["CLDR", "Wikidata"] as const;
export type SnapshotSource = (typeof SNAPSHOT_SOURCES)[number];

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

/** The release a data update needs under ADR-0007: patch for Name and Alias corrections, minor for anything else. */
export type Bump = "patch" | "minor";

/** What a data update changed in the Data packs, and how it is released. */
export interface DataUpdate {
  aliases: AliasChanges;
  /** The smallest bump its changes need, or `null` when no Data pack changed. */
  bump: Bump | null;
  /** The Sources whose Snapshots changed. */
  sources: SnapshotSource[];
}

const AliasesFileSchema = z.record(z.string(), z.array(z.string()));
const EntitiesFileSchema = z.array(z.looseObject({ id: z.string(), name: z.string() }));

/** Every file under a Data packs directory, by path relative to it. */
async function readDataDir(dir: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    files.set(path.slice(dir.length + 1), await readFile(path, "utf8"));
  }
  return files;
}

/** Every Alias in the `*.aliases.json` files of a Data packs directory, keyed by `id` and Alias. */
function aliasesIn(files: ReadonlyMap<string, string>): Map<string, EntityAlias> {
  const aliases = new Map<string, EntityAlias>();
  for (const [path, text] of files) {
    if (!path.endsWith(".aliases.json")) continue;
    for (const [id, entityAliases] of Object.entries(AliasesFileSchema.parse(JSON.parse(text))))
      for (const alias of entityAliases) aliases.set(`${id}\t${alias}`, { id, alias });
  }
  return aliases;
}

/** The Aliases in `from` that aren't in `other`. */
function missingFrom(
  from: ReadonlyMap<string, EntityAlias>,
  other: ReadonlyMap<string, EntityAlias>,
): EntityAlias[] {
  return [...from].filter(([key]) => !other.has(key)).map(([, alias]) => alias);
}

/** Orders Aliases by Entity `id`, then by Alias. */
function byIdAndAlias(a: EntityAlias, b: EntityAlias): number {
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return a.alias < b.alias ? -1 : a.alias > b.alias ? 1 : 0;
}

/**
 * The bump one changed Data pack file needs. Aliases are corrections (patch). In an Entities file, a changed Name is a
 * correction too, but an Entity added, removed or with any other field changed (codes, Parent, Same-as links,
 * Successors) is minor, as is any change to former codes. The generated `.ts` modules only repeat what the JSON holds.
 */
function fileBump(
  path: string,
  before: string | undefined,
  after: string | undefined,
): Bump | null {
  if (before === after || path.endsWith(".ts")) return null;
  if (path.endsWith(".aliases.json")) return "patch";
  if (before === undefined || after === undefined || path.endsWith(".former-codes.json"))
    return "minor";
  const entities = (text: string) =>
    new Map(EntitiesFileSchema.parse(JSON.parse(text)).map((entity) => [entity.id, entity]));
  const [old, current] = [entities(before), entities(after)];
  if (old.size !== current.size) return "minor";
  let bump: Bump | null = null;
  for (const [id, entity] of current) {
    const previous = old.get(id);
    if (previous === undefined) return "minor";
    const { name, ...rest } = entity;
    const { name: previousName, ...previousRest } = previous;
    if (JSON.stringify(rest) !== JSON.stringify(previousRest)) return "minor";
    if (name !== previousName) bump = "patch";
  }
  return bump;
}

/**
 * Compares two Data packs directories, from before and after a data update: which Aliases it adds and removes, whether
 * the removals outnumber the additions by more than {@link ALIAS_REMOVAL_THRESHOLD} (flagged), and the bump ADR-0007
 * gives its changes.
 */
export async function assessDataUpdate({
  beforeDir,
  afterDir,
  sources,
}: {
  beforeDir: string;
  afterDir: string;
  sources: readonly SnapshotSource[];
}): Promise<DataUpdate> {
  const before = await readDataDir(beforeDir);
  const after = await readDataDir(afterDir);
  const [beforeAliases, afterAliases] = [aliasesIn(before), aliasesIn(after)];
  const added = missingFrom(afterAliases, beforeAliases).sort(byIdAndAlias);
  const removed = missingFrom(beforeAliases, afterAliases).sort(byIdAndAlias);
  let bump: Bump | null = null;
  for (const path of new Set([...before.keys(), ...after.keys()])) {
    const file = fileBump(path, before.get(path), after.get(path));
    if (file === "minor") bump = "minor";
    else if (file === "patch") bump ??= "patch";
  }
  return {
    aliases: { added, removed, flagged: removed.length - added.length > ALIAS_REMOVAL_THRESHOLD },
    bump,
    sources: SNAPSHOT_SOURCES.filter((source) => sources.includes(source)),
  };
}

/** The changed Snapshots, as the changeset and PR body name them, such as `CLDR and Wikidata Snapshots`. */
function snapshotsLabel({ sources }: DataUpdate): string {
  if (sources.length === 0) return "Snapshots";
  return `${sources.join(" and ")} Snapshot${sources.length > 1 ? "s" : ""}`;
}

/**
 * The changeset that releases a data update (ADR-0007), or `null` when no Data pack changed, or when its Aliases are
 * flagged, so a maintainer chooses the bump.
 */
export function dataUpdateChangeset(update: DataUpdate): string | null {
  if (update.bump === null || update.aliases.flagged) return null;
  return `---\n"geo-resolve": ${update.bump}\n---\n\nUpdate the data from the latest ${snapshotsLabel(update)}.\n`;
}

/** A Markdown warning, as a GitHub alert, that lists the removed Aliases. */
function removalWarning({ added, removed }: AliasChanges): string {
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
    "",
    "So this PR adds no changeset: a maintainer needs to choose the bump under ADR-0007 and add a changeset to this branch just before merging, since each run rebuilds the branch from main.",
  ]
    .map((line) => (line === "" ? ">" : `> ${line}`))
    .join("\n")
    .concat("\n");
}

/** The data-update PR's body (ADR-0008): any removal warning, what to review, the changeset bump and the build report diff. */
export function dataUpdatePrBody(update: DataUpdate, buildReportDiff: string): string {
  const warning = update.aliases.flagged ? `${removalWarning(update.aliases)}\n` : "";
  const changeset = dataUpdateChangeset(update);
  const diff =
    buildReportDiff === ""
      ? "The build report is unchanged."
      : buildReportDiff.length > MAX_BODY_DIFF - warning.length
        ? "The diff is too long to show here; see `tools/codegen/build-report.md` in the changed files."
        : `\`\`\`\`diff\n${buildReportDiff.replace(/\n$/, "")}\n\`\`\`\``;
  return [
    warning,
    `The weekly data update (ADR-0008) found upstream changes in the ${snapshotsLabel(update)}. Review the changes before merging.\n\n`,
    "This branch is rebuilt from main on every run, so put any Overlay or allowlist fixes in a separate PR.\n\n",
    "Check new Aliases for harm (a clash, junk or vandalism), not for their language: a foreign name in an English Locale is kept (ADR-0013). Remove a harmful one through the Overlay, in a separate PR.\n\n",
    changeset === null
      ? ""
      : `It adds a ${update.bump} changeset. Check the bump against ADR-0007, and list any ISO 3166 change notices in it, before merging.\n\n`,
    `## Build report diff\n\n${diff}\n`,
  ].join("");
}
