import { expectTypeOf, test } from "vite-plus/test";
import {
  createResolver,
  resolve,
  resolveAll,
  toAlpha2,
  toAlpha3,
  toName,
  toNumeric,
  toSubdivisionCode,
  type Codes,
  type Kind,
  type KnownCodeSystem,
  type KnownScheme,
  type KnownAlpha2,
  type KnownAlpha3,
  type KnownSubdivisionCode,
  type ResolveOptions,
  type Resolver,
  type ResolverOptions,
  type Scheme,
} from "geo-resolve";

// Checked by `typecheck`: these assert the public types ADR-0006 promises, not runtime behaviour.

test("the Known unions hold the codes of the current release", () => {
  expectTypeOf<"DE">().toExtend<KnownAlpha2>();
  expectTypeOf<"DEU">().toExtend<KnownAlpha3>();
  expectTypeOf<"US-CA">().toExtend<KnownSubdivisionCode>();
  expectTypeOf<"YU">().not.toExtend<KnownAlpha2>();
});

test("public signatures take and return string, not a Known union", () => {
  expectTypeOf(toAlpha2).parameter(0).toEqualTypeOf<string>();
  expectTypeOf(toAlpha2).returns.toEqualTypeOf<string | null>();
});

test("every function takes one required argument plus one optional options object", () => {
  const exported = {
    resolve,
    resolveAll,
    toAlpha2,
    toAlpha3,
    toNumeric,
    toSubdivisionCode,
    toName,
  };
  expectTypeOf<Parameters<(typeof exported)[keyof typeof exported]>>().toEqualTypeOf<
    [input: string, options?: ResolveOptions]
  >();
  expectTypeOf<Parameters<Resolver[keyof Resolver]>>().toEqualTypeOf<
    [input: string, options?: ResolveOptions]
  >();
  // Its one argument is the options object.
  expectTypeOf(createResolver).parameters.toEqualTypeOf<[ResolverOptions]>();
});

test("Kind, the Codes keys and Scheme are open to values a later release may add", () => {
  expectTypeOf<"region">().toExtend<Kind>();
  expectTypeOf<{ unsd: "276" }>().toExtend<Codes>();
  expectTypeOf<"cctld">().toExtend<Scheme>();
});

test("every shipped Code system is a Scheme, so a new one needs no change to from", () => {
  expectTypeOf<KnownCodeSystem>().toExtend<KnownScheme>();
  expectTypeOf<ResolveOptions["from"]>().toEqualTypeOf<readonly Scheme[] | undefined>();
});
