import { expect, test } from "vite-plus/test";
import { createResolver, resolve, type DataPack } from "geo-resolve";
import countries from "geo-resolve/data/countries";
import subdivisions from "geo-resolve/data/subdivisions";
import usSubdivisions from "geo-resolve/data/subdivisions/US";

const resolver = createResolver({ data: [countries, subdivisions] });

const california = {
  kind: "subdivision",
  id: "US-CA",
  code: "US-CA",
  country: "US",
  parent: "US",
  name: "California",
};

test.each(["US-CA", "us-ca", "California", " CALIFORNIA "])(
  "resolves %j to the Subdivision California",
  (input) => {
    expect(resolver.resolve(input)).toEqual(california);
  },
);

test("full Subdivision codes resolve without options", () => {
  expect(resolver.resolve("GB-ENG")?.name).toBe("England");
  expect(resolver.resolve("ES-AN")?.name).toBe("Andalusia");
});

test("a Subdivision's Parent may be another Subdivision", () => {
  expect(resolver.resolve("ES-AL")).toEqual({
    kind: "subdivision",
    id: "ES-AL",
    code: "ES-AL",
    country: "ES",
    parent: "ES-AN",
    name: "Almería",
  });
});

// The ADR-0004 examples, literally.
test('"Georgia" is ambiguous between the Country GE and the Subdivision US-GA', () => {
  expect(resolver.resolve("Georgia")).toBeNull();
  expect(resolver.resolveAll("Georgia").map((entity) => entity.id)).toEqual(["GE", "US-GA"]);
});

test('kinds: ["country"] resolves "Georgia" to GE', () => {
  expect(resolver.resolve("Georgia", { kinds: ["country"] })?.id).toBe("GE");
});

test('kinds: ["subdivision"] resolves "Georgia" to US-GA', () => {
  expect(resolver.resolve("Georgia", { kinds: ["subdivision"] })?.id).toBe("US-GA");
});

test('"Limburg" stays ambiguous between BE-VLI and NL-LI with kinds: ["subdivision"]', () => {
  expect(resolver.resolve("Limburg", { kinds: ["subdivision"] })).toBeNull();
  expect(
    resolver.resolveAll("Limburg", { kinds: ["subdivision"] }).map((entity) => entity.id),
  ).toEqual(["BE-VLI", "NL-LI"]);
});

test('Subdivision codes match only in full: "CA" is the Country CA', () => {
  expect(resolver.resolve("CA")?.id).toBe("CA");
  expect(resolver.resolveAll("CA")).toHaveLength(1);
});

test("a Resolver exposes the to* helpers, including toSubdivisionCode", () => {
  expect(resolver.toSubdivisionCode("California")).toBe("US-CA");
  expect(resolver.toName("us-ca")).toBe("California");
  expect(resolver.toAlpha2("Germany")).toBe("DE");
  expect(resolver.toAlpha3("Germany")).toBe("DEU");
  expect(resolver.toNumeric("Germany")).toBe("276");
});

test("to* helpers return null for an Entity with no such code", () => {
  expect(resolver.toSubdivisionCode("Germany")).toBeNull();
  expect(resolver.toAlpha2("California")).toBeNull();
  expect(resolver.toAlpha3("California")).toBeNull();
  expect(resolver.toNumeric("California")).toBeNull();
});

test("to* helpers accept the same options as resolve", () => {
  expect(resolver.toSubdivisionCode("Georgia")).toBeNull();
  expect(resolver.toSubdivisionCode("Georgia", { kinds: ["subdivision"] })).toBe("US-GA");
  expect(resolver.toAlpha2("Georgia", { kinds: ["country"] })).toBe("GE");
});

test("a per-Country Data pack holds only that Country's Subdivisions", () => {
  const us = createResolver({ data: [usSubdivisions] });
  expect(us.resolve("Georgia")?.id).toBe("US-GA");
  expect(us.resolve("Andalusia")).toBeNull();
  expect(us.resolve("US")).toBeNull();
  expect(usSubdivisions.every((subdivision) => subdivision.country === "US")).toBe(true);
});

test("loading a per-Country Data pack alongside all Subdivisions doesn't duplicate its Entities", () => {
  const overlapping = createResolver({ data: [subdivisions, usSubdivisions] });
  expect(overlapping.resolve("Texas")?.id).toBe("US-TX");
});

test("a Resolver resolves only the Data packs passed to it", () => {
  expect(createResolver({ data: [] }).resolve("Germany")).toBeNull();
  expect(createResolver({ data: [countries] }).resolve("California")).toBeNull();
});

test("Resolvers are independent", () => {
  const countriesOnly = createResolver({ data: [countries] });
  expect(resolver.resolve("Georgia")).toBeNull();
  expect(countriesOnly.resolve("Georgia")?.id).toBe("GE");
  expect(resolver.resolve("Georgia")).toBeNull();
});

test("a Resolver's functions work detached from it", () => {
  const { resolve: detached, toSubdivisionCode } = resolver;
  expect(detached("California")?.id).toBe("US-CA");
  expect(toSubdivisionCode("California")).toBe("US-CA");
});

test("Data packs and their Entities are frozen", () => {
  expect(Object.isFrozen(subdivisions)).toBe(true);
  expect(Object.isFrozen(usSubdivisions[0])).toBe(true);
  expect(Object.isFrozen(countries)).toBe(true);
});

test("the default entry still resolves Countries only", () => {
  expect(resolve("Georgia")?.id).toBe("GE");
  expect(resolve("US-CA")).toBeNull();
  expect(resolve("California")).toBeNull();
});

test("a Resolver keeps the Data packs it was created with", () => {
  const data: DataPack[] = [countries];
  const snapshot = createResolver({ data });
  data.push(subdivisions);
  expect(snapshot.resolve("Georgia")?.id).toBe("GE");
});
