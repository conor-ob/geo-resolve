import { expect, test } from "vite-plus/test";
import { createResolver, resolve, resolveAll, toAlpha2 } from "geo-resolve";
import countries from "geo-resolve/data/countries";
import historicCountries from "geo-resolve/data/historic-countries";
import usSubdivisions from "geo-resolve/data/subdivisions/US";

test("from settles a code shared across Schemes: BRN is Bahrain's IOC code and Brunei's Alpha-3 code", () => {
  expect(resolve("BRN")).toBeNull();
  expect(resolve("BRN", { from: ["alpha3"] })?.id).toBe("BN");
  expect(resolve("BRN", { from: ["ioc"] })?.id).toBe("BH");
});

test("from applies to the to* helpers", () => {
  expect(toAlpha2("BRN", { from: ["ioc"] })).toBe("BH");
});

test("with from, a Name never matches, since Names belong to no Scheme", () => {
  expect(resolve("Brunei")?.id).toBe("BN");
  expect(resolve("Brunei", { from: ["alpha3"] })).toBeNull();
});

test("with from, an Alias never matches", () => {
  expect(resolve("Holland")?.id).toBe("NL");
  expect(resolve("Holland", { from: ["alpha2", "alpha3", "numeric", "ioc", "fifa"] })).toBeNull();
});

test("a Territory's user-assigned id belongs to no Scheme, but its Code system codes do", () => {
  expect(resolve("XK")?.id).toBe("XK");
  expect(resolve("XK", { from: ["alpha2"] })).toBeNull();
  expect(resolve("KOS", { from: ["ioc"] })?.id).toBe("XK");
});

test("an unknown Scheme or an empty from matches nothing, without throwing", () => {
  expect(resolveAll("DE", { from: ["cctld"] })).toEqual([]);
  expect(resolveAll("DE", { from: [] })).toEqual([]);
});

test("a Numeric code matches only from numeric", () => {
  expect(resolve("276", { from: ["numeric"] })?.id).toBe("DE");
  expect(resolve("276", { from: ["alpha3"] })).toBeNull();
});

const withHistoric = createResolver({ data: [countries, historicCountries] });

test.each([
  ["ANT", "ANHH", "AG"],
  ["BUR", "BUMM", "BF"],
])(
  "a Historic country's former Alpha-3 code %s counts as alpha3 (%s), not the IOC code (%s)",
  (input, historic, ioc) => {
    expect(withHistoric.resolve(input)).toBeNull();
    expect(withHistoric.resolve(input, { from: ["alpha3"] })?.id).toBe(historic);
    expect(withHistoric.resolve(input, { from: ["ioc"] })?.id).toBe(ioc);
  },
);

test("an Alpha-4 code matches from alpha4", () => {
  expect(withHistoric.resolve("YUCS", { from: ["alpha4"] })?.id).toBe("YUCS");
  expect(withHistoric.resolve("YUCS", { from: ["alpha2"] })).toBeNull();
});

const withUs = createResolver({ data: [countries, usSubdivisions] });

test("under within, a bare Subdivision code suffix counts as a Subdivision code", () => {
  expect(withUs.resolve("CA", { within: "US", from: ["subdivision-code"] })?.id).toBe("US-CA");
  expect(withUs.resolve("CA", { within: "US", from: ["alpha2"] })).toBeNull();
  expect(withUs.resolve("US-CA", { from: ["subdivision-code"] })?.id).toBe("US-CA");
});

test("from combines with kinds", () => {
  expect(withUs.resolve("US-CA", { kinds: ["country"], from: ["subdivision-code"] })).toBeNull();
});

test("a former code of a Country that still exists counts under the Scheme that issued it: ROM is alpha3", () => {
  expect(resolve("ROM")?.id).toBe("RO");
  expect(resolve("ROM", { from: ["alpha3"] })?.id).toBe("RO");
  expect(resolve("ROM", { from: ["alpha2"] })).toBeNull();
});
