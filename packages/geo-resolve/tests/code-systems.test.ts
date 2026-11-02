import { expect, test } from "vite-plus/test";
import { createResolver, resolve, resolveAll, type Codes, type Entity } from "geo-resolve";
import countries from "geo-resolve/data/countries";
import gbSubdivisions from "geo-resolve/data/subdivisions/GB";

/** The Code system codes of an Entity that can have them; Historic countries can't. */
function codesOf(entity: Entity | null): Codes | undefined {
  return entity !== null && "codes" in entity ? entity.codes : undefined;
}

test.each([
  ["GER", "DE"],
  ["ger", "DE"],
  ["NED", "NL"],
  ["SUI", "CH"],
])("resolves the IOC code %s to its Country", (input, id) => {
  expect(resolve(input)?.id).toBe(id);
});

test("resolves Aliases taken from Wikidata", () => {
  expect(resolve("Holland")?.id).toBe("NL");
});

test("a code shared by two Entities is ambiguous: BRN is Bahrain's IOC code and Brunei's Alpha-3 code", () => {
  expect(resolve("BRN")).toBeNull();
  expect(resolveAll("BRN").map((entity) => entity.id)).toEqual(["BH", "BN"]);
});

test("a Country carries its codes in non-ISO Code systems under codes", () => {
  expect(codesOf(resolve("DE"))).toEqual({ ioc: "GER", fifa: "GER" });
});

test("FIFA's home nations are the Subdivisions of GB, which has no FIFA code", () => {
  const resolver = createResolver({ data: [countries, gbSubdivisions] });
  expect(
    ["GB-ENG", "GB-SCT", "GB-WLS", "GB-NIR"].map((id) => codesOf(resolver.resolve(id))?.fifa),
  ).toEqual(["ENG", "SCO", "WAL", "NIR"]);
  expect(codesOf(resolver.resolve("GB"))).toEqual({ ioc: "GBR" });
  expect(resolver.resolve("ENG")?.id).toBe("GB-ENG");
  expect(resolver.resolve("NIR")?.id).toBe("GB-NIR");
});
