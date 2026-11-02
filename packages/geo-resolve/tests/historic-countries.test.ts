import { expect, test } from "vite-plus/test";
import { createResolver, resolve as defaultResolve } from "geo-resolve";
import countries from "geo-resolve/data/countries";
import historicCountries from "geo-resolve/data/historic-countries";

const resolver = createResolver({ data: [countries, historicCountries] });

const serbiaAndMontenegro = {
  kind: "historic-country",
  id: "CSXX",
  alpha4: "CSXX",
  alpha2: "CS",
  alpha3: "SCG",
  numeric: "891",
  name: "Serbia and Montenegro",
  withdrawn: "2006-09-26",
  successors: ["ME", "RS"],
};

test.each(["CSXX", "csxx", "SCG", "Serbia and Montenegro"])(
  "resolves %j to the Historic country Serbia and Montenegro",
  (input) => {
    expect(resolver.resolve(input)).toEqual(serbiaAndMontenegro);
  },
);

// The ADR-0004 example, literally: ISO reused CS, so only the Alpha-4 code is unique.
test('"CS" is ambiguous between Czechoslovakia (CSHH) and Serbia and Montenegro (CSXX)', () => {
  expect(resolver.resolve("CS")).toBeNull();
  expect(resolver.resolveAll("CS").map((entity) => entity.id)).toEqual(["CSHH", "CSXX"]);
  expect(resolver.resolve("CSHH")?.name).toBe("Czechoslovakia");
});

test("Successors are Entity ids that may be Historic countries: YUCS → CSXX → RS, ME", () => {
  const yugoslavia = resolver.resolve("YU");
  expect(yugoslavia).toMatchObject({ id: "YUCS", withdrawn: "2003-07-23", successors: ["CSXX"] });
  const [next] = yugoslavia?.kind === "historic-country" ? yugoslavia.successors : [];
  const serbiaAndMontenegro = resolver.resolve(next!);
  expect(
    serbiaAndMontenegro?.kind === "historic-country" && serbiaAndMontenegro.successors,
  ).toEqual(["ME", "RS"]);
  expect(resolver.toName("ME")).toBe("Montenegro");
  expect(resolver.toName("RS")).toBe("Serbia");
});

test("a Historic country is never mapped to a Successor", () => {
  expect(resolver.resolve("SU")?.kind).toBe("historic-country");
  expect(resolver.toAlpha2("Soviet Union")).toBe("SU");
});

test("withdrawal dates keep the precision ISO published", () => {
  expect(resolver.resolve("SUHH")).toMatchObject({ withdrawn: "1992" });
});

test("a Historic country with no former Numeric code has no numeric field", () => {
  const dahomey = resolver.resolve("DYBJ");
  expect(dahomey).toMatchObject({ alpha2: "DY", alpha3: "DHY", successors: ["BJ"] });
  expect(dahomey).not.toHaveProperty("numeric");
  expect(resolver.toNumeric("DYBJ")).toBeNull();
});

test("all 31 ISO 3166-3 Historic countries are in their Data pack", () => {
  expect(historicCountries).toHaveLength(31);
  expect(historicCountries.every((entity) => entity.kind === "historic-country")).toBe(true);
  expect(Object.isFrozen(historicCountries)).toBe(true);
  expect(Object.isFrozen(historicCountries[0])).toBe(true);
});

const romania = {
  kind: "country",
  id: "RO",
  alpha2: "RO",
  alpha3: "ROU",
  numeric: "642",
  name: "Romania",
  codes: { ioc: "ROU", fifa: "ROU" },
};

test("a former code of a Country that still exists resolves to the Country, not a Historic country", () => {
  expect(resolver.resolveAll("ROM")).toEqual([romania]);
  expect(resolver.toAlpha3("rom")).toBe("ROU");
});

test("former codes resolve from the default entry, which has no Historic countries", () => {
  expect(defaultResolve("ROM")).toEqual(romania);
});

test("ISO's formal names of Historic countries resolve", () => {
  expect(resolver.resolve("USSR, Union of Soviet Socialist Republics")?.id).toBe("SUHH");
  expect(resolver.resolve("German Democratic Republic")?.id).toBe("DDDE");
});

test("Aliases are used for matching but not exposed on Entities", () => {
  expect(Object.keys(resolver.resolve("ROM")!)).toEqual(Object.keys(romania));
  expect(resolver.resolve("USSR")).not.toHaveProperty("aliases");
});
