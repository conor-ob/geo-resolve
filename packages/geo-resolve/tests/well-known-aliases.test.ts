import { expect, test } from "vite-plus/test";
import { resolve } from "geo-resolve";

// These Aliases come from the CLDR and Wikidata Snapshots, which the weekly data update regenerates
// (ADR-0008). A Snapshot change once dropped every Alias below without turning CI red (PR #77), so
// these pin well-known Inputs callers rely on. When an Alias that matters goes missing, add it here.
test.each([
  ["Swaziland", "SZ"],
  ["Viet Nam", "VN"],
  ["Malvinas", "FK"],
  ["Kosova", "XK"],
  ["CNMI", "MP"],
  ["Congo", "CG"],
  ["Congo-Brazzaville", "CG"],
  ["Hellas", "GR"],
])("resolves the well-known Alias %j to %s", (input, id) => {
  expect(resolve(input)?.id).toBe(id);
});
