import { expect, test } from "vite-plus/test";
import { createResolver, resolve as defaultResolve } from "geo-resolve";
import countries from "geo-resolve/data/countries";
import subdivisions from "geo-resolve/data/subdivisions";

const resolver = createResolver({ data: [countries, subdivisions] });

// The Consequence of ADR-0004 the spec calls out: no hidden tie-break between linked Entities.
test('"Puerto Rico" is ambiguous with both Data packs loaded, and narrows by Kind or within', () => {
  expect(resolver.resolve("Puerto Rico")).toBeNull();
  expect(resolver.resolveAll("Puerto Rico").map((entity) => entity.id)).toEqual(["PR", "US-PR"]);
  expect(resolver.resolve("Puerto Rico", { kinds: ["country"] })?.id).toBe("PR");
  expect(resolver.resolve("Puerto Rico", { within: "US" })?.id).toBe("US-PR");
});

test('"Puerto Rico" is the Country PR from the default entry, which has no Subdivisions', () => {
  expect(defaultResolve("Puerto Rico")?.id).toBe("PR");
});

test("a Same-as link joins both sides, and each keeps its own codes and Parent", () => {
  expect(resolver.resolve("PR")).toEqual({
    kind: "country",
    id: "PR",
    alpha2: "PR",
    alpha3: "PRI",
    numeric: "630",
    name: "Puerto Rico",
    sameAs: ["US-PR"],
  });
  expect(resolver.resolve("US-PR")).toEqual({
    kind: "subdivision",
    id: "US-PR",
    code: "US-PR",
    country: "US",
    parent: "US",
    name: "Puerto Rico",
    sameAs: ["PR"],
  });
});

// Each Country ISO 3166-1 lists that ISO 3166-2 also lists as a Subdivision of another Country.
const listedTwice: [country: string, subdivision: string][] = [
  ["AS", "US-AS"],
  ["AW", "NL-AW"],
  ["AX", "FI-01"],
  ["BL", "FR-BL"],
  ["CW", "NL-CW"],
  ["GF", "FR-973"],
  ["GP", "FR-971"],
  ["GU", "US-GU"],
  ["HK", "CN-HK"],
  ["MF", "FR-MF"],
  ["MO", "CN-MO"],
  ["MP", "US-MP"],
  ["MQ", "FR-972"],
  ["NC", "FR-NC"],
  ["PF", "FR-PF"],
  ["PM", "FR-PM"],
  ["PR", "US-PR"],
  ["RE", "FR-974"],
  ["SX", "NL-SX"],
  ["TF", "FR-TF"],
  ["TW", "CN-TW"],
  ["UM", "US-UM"],
  ["VI", "US-VI"],
  ["WF", "FR-WF"],
  ["YT", "FR-976"],
];

test("every Country and Subdivision that ISO lists twice is linked on both sides, and nothing else is", () => {
  const linked = [...countries, ...subdivisions].flatMap((entity) =>
    "sameAs" in entity && entity.sameAs !== undefined
      ? entity.sameAs.map((other) => `${entity.id} → ${other}`)
      : [],
  );
  const expected = listedTwice.flatMap(([country, subdivision]) => [
    `${country} → ${subdivision}`,
    `${subdivision} → ${country}`,
  ]);
  const byText = (a: string, b: string) => a.localeCompare(b);
  expect(linked.sort(byText)).toEqual(expected.sort(byText));
});
