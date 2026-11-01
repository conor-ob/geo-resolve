import { expect, test } from "vite-plus/test";
import { resolve, resolveAll, toAlpha2, toAlpha3, toName, toNumeric } from "geo-resolve";

const germany = {
  kind: "country",
  id: "DE",
  alpha2: "DE",
  alpha3: "DEU",
  numeric: "276",
  name: "Germany",
};

test.each(["DE", "DEU", "276", "Germany"])("resolves %s to the Country Germany", (input) => {
  expect(resolve(input)).toEqual(germany);
});

test.each(["de", "De", "deu", " germany ", "GERMANY"])(
  "ignores case and surrounding whitespace: %j",
  (input) => {
    expect(resolve(input)?.id).toBe("DE");
  },
);

test.each(["Åland Islands", "aland islands", "ÅLAND   ISLANDS", "Aland\tIslands"])(
  "ignores diacritics and collapses internal whitespace: %j",
  (input) => {
    expect(resolve(input)?.id).toBe("AX");
  },
);

test("matches Names exactly after normalisation, never fuzzily", () => {
  expect(resolve("Germ")).toBeNull();
  expect(resolve("Germany!")).toBeNull();
  expect(resolve("Aland Island")).toBeNull();
});

test("returns null when nothing matches", () => {
  expect(resolve("Atlantis")).toBeNull();
  expect(resolve("")).toBeNull();
});

test("Numeric codes match only as three-digit strings", () => {
  expect(resolve("020")?.id).toBe("AD");
  expect(resolve("20")).toBeNull();
  expect(resolve("0276")).toBeNull();
});

test("resolveAll returns every Candidate, or none", () => {
  expect(resolveAll("deu")).toEqual([germany]);
  expect(resolveAll("Atlantis")).toEqual([]);
});

test("kinds limits which Kinds are considered", () => {
  expect(resolve("DE", { kinds: ["country"] })?.id).toBe("DE");
  expect(resolve("DE", { kinds: ["subdivision", "historic-country"] })).toBeNull();
  expect(resolveAll("DE", { kinds: ["territory"] })).toEqual([]);
});

test("Entities are frozen", () => {
  const entity = resolve("DE");
  expect(Object.isFrozen(entity)).toBe(true);
  expect(() => {
    (entity as { name: string }).name = "Deutschland";
  }).toThrow(TypeError);
  expect(resolve("DE")?.name).toBe("Germany");
});

test("to* helpers convert any resolvable Input to one field", () => {
  expect(toAlpha2("Germany")).toBe("DE");
  expect(toAlpha3("276")).toBe("DEU");
  expect(toNumeric("de")).toBe("276");
  expect(toName("CIV")).toBe("Côte d’Ivoire");
});

test("to* helpers return null when the Input doesn't resolve", () => {
  expect(toAlpha2("Atlantis")).toBeNull();
  expect(toAlpha3("Atlantis")).toBeNull();
  expect(toNumeric("Atlantis")).toBeNull();
  expect(toName("Atlantis")).toBeNull();
  expect(toAlpha2("DE", { kinds: ["subdivision"] })).toBeNull();
});

test.each([
  ["US", "USA", "840", "United States"],
  ["GB", "GBR", "826", "United Kingdom"],
  ["AX", "ALA", "248", "Åland Islands"],
  ["CI", "CIV", "384", "Côte d’Ivoire"],
  ["PR", "PRI", "630", "Puerto Rico"],
  ["AQ", "ATA", "010", "Antarctica"],
])("every code scheme of %s resolves to the same Country", (alpha2, alpha3, numeric, name) => {
  for (const input of [alpha2, alpha3, numeric, name]) {
    expect(resolve(input)).toEqual({ kind: "country", id: alpha2, alpha2, alpha3, numeric, name });
  }
});
