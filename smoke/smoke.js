// Run against the packed tarball, as a consumer installs it: only published subpaths are importable.
import { createResolver, resolve, toAlpha3 } from "geo-resolve";
import countries from "geo-resolve/data/countries";
import historicCountries from "geo-resolve/data/historic-countries";
import usSubdivisions from "geo-resolve/data/subdivisions/US";

function check(actual, expected, what) {
  if (actual !== expected) throw new Error(`${what}: expected ${expected}, got ${actual}`);
}

check(resolve("Germany")?.id, "DE", "the default entry resolves a Country");
check(toAlpha3("de"), "DEU", "the default entry converts codes");
check(resolve("GER")?.id, "DE", "the default entry resolves Code system codes");
const resolver = createResolver({ data: [countries, historicCountries, usSubdivisions] });
check(resolver.resolve("California")?.id, "US-CA", "a per-Country Subdivisions pack loads");
check(resolver.resolve("YUCS")?.name, "Yugoslavia", "the Historic countries pack loads");

console.log("geo-resolve smoke test passed");
