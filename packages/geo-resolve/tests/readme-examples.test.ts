import { describe, expect, test } from "vite-plus/test";
import {
  createResolver,
  resolve,
  resolveAll,
  toAlpha2,
  toAlpha3,
  toName,
  toNumeric,
} from "geo-resolve";
import countries from "geo-resolve/data/countries";
import historicCountries from "geo-resolve/data/historic-countries";
import subdivisions from "geo-resolve/data/subdivisions";
import gbSubdivisions from "geo-resolve/data/subdivisions/GB";
import usSubdivisions from "geo-resolve/data/subdivisions/US";

// The README's examples, one test per section. `readme.test.ts` runs the README's own code blocks; these
// tests say the same things in plain code, so each claim reads on its own.

const ids = (entities: readonly { id: string }[]) => entities.map((entity) => entity.id);

describe("Resolving an Input", () => {
  test("the default entry resolves a Country by any code, Name or Alias", () => {
    expect(resolve("DEU")).toEqual({
      kind: "country",
      id: "DE",
      alpha2: "DE",
      alpha3: "DEU",
      numeric: "276",
      name: "Germany",
      codes: { ioc: "GER", fifa: "GER" },
    });
    expect(resolve("Holland")?.id).toBe("NL");
    expect(toAlpha2("Germany")).toBe("DE");
    expect(toAlpha3("de")).toBe("DEU");
    expect(toNumeric("DEU")).toBe("276");
    expect(toName("276")).toBe("Germany");
  });

  test('"not found" is null from resolve and [] from resolveAll', () => {
    expect(resolve("Atlantis")).toBeNull();
    expect(resolveAll("Atlantis")).toEqual([]);
  });
});

describe("Data packs and createResolver", () => {
  test("a Resolver over one Country's Subdivisions resolves them", () => {
    const resolver = createResolver({ data: [countries, usSubdivisions] });
    expect(resolver.toSubdivisionCode("California")).toBe("US-CA");
    expect(resolver.resolve("US-TX")?.name).toBe("Texas");
  });
});

describe("Ambiguity and narrowing", () => {
  const resolver = createResolver({ data: [countries, subdivisions, historicCountries] });

  test('"Georgia" is ambiguous until narrowed by Kind or within', () => {
    expect(resolver.resolve("Georgia")).toBeNull();
    expect(ids(resolver.resolveAll("Georgia"))).toEqual(["GE", "US-GA"]);
    expect(resolver.resolve("Georgia", { kinds: ["country"] })?.id).toBe("GE");
    expect(resolver.resolve("Georgia", { kinds: ["subdivision"] })?.id).toBe("US-GA");
    expect(resolver.resolve("Georgia", { within: "US" })?.id).toBe("US-GA");
  });

  test('"Limburg" is ambiguous between two Subdivisions until narrowed by within', () => {
    expect(resolver.resolve("Limburg", { kinds: ["subdivision"] })).toBeNull();
    expect(resolver.resolve("Limburg", { within: "NL" })?.id).toBe("NL-LI");
  });

  test('a bare Subdivision code suffix ("CA") only matches under within', () => {
    expect(resolver.resolve("CA")?.id).toBe("CA");
    expect(resolver.resolve("CA", { within: "US" })?.id).toBe("US-CA");
  });

  test('"CS" is ambiguous between two Historic countries; the Alpha-4 code is not', () => {
    expect(resolver.resolve("CS")).toBeNull();
    expect(resolver.resolve("CSXX")?.name).toBe("Serbia and Montenegro");
  });

  test('the default entry has no Subdivisions, so "Georgia" is the Country there', () => {
    expect(resolve("Georgia")?.id).toBe("GE");
  });

  test('"Puerto Rico" is the Country PR and the Subdivision US-PR, joined by a Same-as link', () => {
    const { resolve, resolveAll } = createResolver({ data: [countries, subdivisions] });
    expect(resolve("Puerto Rico")).toBeNull();
    expect(ids(resolveAll("Puerto Rico"))).toEqual(["PR", "US-PR"]);
    expect(resolve("Puerto Rico", { kinds: ["country"] })?.id).toBe("PR");
    expect(resolve("Puerto Rico", { within: "US" })?.id).toBe("US-PR");
    expect(resolve("US-PR")).toEqual({
      kind: "subdivision",
      id: "US-PR",
      code: "US-PR",
      country: "US",
      parent: "US",
      name: "Puerto Rico",
      sameAs: ["PR"],
    });
  });
});

describe("Historic countries and Successors", () => {
  const resolver = createResolver({ data: [countries, historicCountries] });

  test("a Historic country lists its Successors and when ISO withdrew it", () => {
    expect(resolver.resolve("YUG")).toEqual({
      kind: "historic-country",
      id: "YUCS",
      alpha4: "YUCS",
      alpha2: "YU",
      alpha3: "YUG",
      numeric: "891",
      name: "Yugoslavia",
      withdrawn: "2003-07-23",
      successors: ["CSXX"],
    });
    const serbiaAndMontenegro = resolver.resolve("Serbia and Montenegro");
    expect(serbiaAndMontenegro?.kind).toBe("historic-country");
    if (serbiaAndMontenegro?.kind === "historic-country") {
      expect(serbiaAndMontenegro.successors).toEqual(["ME", "RS"]);
    }
  });

  test("a former code of a Country that still exists resolves to that Country", () => {
    expect(resolver.resolve("ROM")?.id).toBe("RO");
  });
});

describe("Territories and Kosovo", () => {
  test("Kosovo resolves from the default entry, as a Territory with no ISO codes", () => {
    expect(resolve("KOS")).toEqual({
      kind: "territory",
      id: "XK",
      name: "Kosovo",
      codes: { ioc: "KOS", fifa: "KOS" },
    });
    expect(resolve("XK")?.name).toBe("Kosovo");
    expect(toAlpha2("Kosovo")).toBeNull();
    expect(resolve("Kosovo", { kinds: ["country"] })).toBeNull();
    expect(resolve("Kosovo", { kinds: ["country", "territory"] })?.id).toBe("XK");
  });
});

describe("Code systems", () => {
  test("FIFA's home nation codes resolve to the GB Subdivisions", () => {
    const resolver = createResolver({ data: [countries, gbSubdivisions] });
    expect(resolver.resolve("ENG")?.id).toBe("GB-ENG");
    expect(resolver.toSubdivisionCode("SCO")).toBe("GB-SCT");
    expect(resolver.resolve("WAL")?.name).toBe("Wales");
    expect(resolver.resolve("NIR")).toEqual({
      kind: "subdivision",
      id: "GB-NIR",
      code: "GB-NIR",
      country: "GB",
      parent: "GB",
      name: "Northern Ireland",
      codes: { fifa: "NIR" },
    });
    expect(resolve("ENG")).toBeNull();
  });

  test('"BRN" is ambiguous between Brunei (Alpha-3) and Bahrain (IOC) until narrowed by from', () => {
    expect(resolve("BRN")).toBeNull();
    expect(ids(resolveAll("BRN"))).toEqual(["BH", "BN"]);
    expect(toName("BRN", { from: ["alpha3"] })).toBe("Brunei");
    expect(toName("BRN", { from: ["ioc"] })).toBe("Bahrain");
    expect(resolve("Bahrain", { from: ["ioc"] })).toBeNull();
  });
});
