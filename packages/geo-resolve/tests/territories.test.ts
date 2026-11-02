import { expect, test } from "vite-plus/test";
import { createResolver, resolve, resolveAll, toAlpha2, toAlpha3, toNumeric } from "geo-resolve";
import countries from "geo-resolve/data/countries";
import rsSubdivisions from "geo-resolve/data/subdivisions/RS";
import territories from "geo-resolve/data/territories";

const kosovo = { kind: "territory", id: "XK", name: "Kosovo", codes: { ioc: "KOS", fifa: "KOS" } };

test.each(["Kosovo", "kosovo", "KOS", "XK", "Republic of Kosovo"])(
  "the default entry resolves %j to the Territory Kosovo",
  (input) => {
    expect(resolve(input)).toEqual(kosovo);
  },
);

test("a Territory has no ISO-named fields, so it converts to no ISO code", () => {
  expect(resolve("Kosovo")).not.toHaveProperty("alpha2");
  expect(toAlpha2("Kosovo")).toBeNull();
  expect(toAlpha3("Kosovo")).toBeNull();
  expect(toNumeric("Kosovo")).toBeNull();
});

test("kinds: Territories are not Countries", () => {
  expect(resolve("Kosovo", { kinds: ["country"] })).toBeNull();
  expect(resolve("Kosovo", { kinds: ["territory"] })?.id).toBe("XK");
  expect(resolve("KOS", { kinds: ["country", "territory"] })?.id).toBe("XK");
});

test("the Territories Data pack and its Entities are frozen", () => {
  expect(Object.isFrozen(territories)).toBe(true);
  expect(Object.isFrozen(territories[0])).toBe(true);
});

test("the Territories Data pack loads into createResolver", () => {
  const resolver = createResolver({ data: [territories] });
  expect(resolver.resolve("KOS")).toEqual(kosovo);
  expect(resolver.resolve("Germany")).toBeNull();
});

// ISO lists Kosovo as the Serbian Subdivision RS-KM, and one of its districts, RS-25, is named Kosovo (ADR-0012).
test('"Kosovo" is ambiguous with the Serbian district RS-25 once its Subdivisions are loaded', () => {
  const resolver = createResolver({ data: [countries, territories, rsSubdivisions] });
  expect(resolver.resolve("Kosovo")).toBeNull();
  expect(resolver.resolveAll("Kosovo").map((entity) => entity.id)).toEqual(["RS-25", "XK"]);
  expect(resolver.resolve("Kosovo", { kinds: ["territory"] })?.id).toBe("XK");
});

test('within: "XK" matches only Kosovo itself, which has no Subdivisions', () => {
  const resolver = createResolver({ data: [countries, territories, rsSubdivisions] });
  expect(resolver.resolveAll("Kosovo", { within: "XK" }).map((entity) => entity.id)).toEqual([
    "XK",
  ]);
  expect(resolver.resolve("Kosovo-Metohija", { within: "XK" })).toBeNull();
  expect(resolver.resolve("Prizren", { within: "XK" })).toBeNull();
});

test("resolveAll lists Territories after the other Kinds", () => {
  const resolver = createResolver({
    data: [countries, territories, rsSubdivisions],
  });
  expect(resolver.resolveAll("Kosovo").at(-1)?.kind).toBe("territory");
  expect(resolveAll("XK")).toEqual([kosovo]);
});
