import { readFileSync } from "node:fs";
import { expect, test } from "vite-plus/test";
import { createResolver } from "geo-resolve";
import countries from "geo-resolve/data/countries";
import historicCountries from "geo-resolve/data/historic-countries";
import subdivisions from "geo-resolve/data/subdivisions";
import territories from "geo-resolve/data/territories";

// An English Alias must denote one Entity, or the Entities a Same-as link joins it to (ADR-0013). A single upstream
// Wikidata edit once made "Congo" an Alias of both CD and CG, so it stopped resolving without turning CI red (#90).
const resolver = createResolver({
  data: [countries, territories, historicCountries, subdivisions],
});
// Historic countries have no Same-as links.
const linked = [...countries, ...territories];

const aliasPacks = ["countries", "territories", "historic-countries"].map(
  (pack): Record<string, string[]> =>
    JSON.parse(readFileSync(new URL(`../src/data/${pack}.aliases.json`, import.meta.url), "utf8")),
);
const aliases = aliasPacks.flatMap((pack) =>
  Object.entries(pack).flatMap(([id, names]) => names.map((alias) => [alias, id] as const)),
);

test("the Aliases are read from the shipped Data packs", () => {
  expect(aliases).toContainEqual(["Swaziland", "SZ"]);
});

test.each(aliases)("the Alias %j denotes only %s and its Same-as Entities", (alias, id) => {
  const sameAs = linked.find((entity) => entity.id === id)?.sameAs ?? [];
  const candidates = resolver.resolveAll(alias).map((entity) => entity.id);
  expect(candidates.filter((candidate) => !sameAs.includes(candidate))).toEqual([id]);
});
