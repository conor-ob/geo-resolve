import { defaultServerConditions, defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    // The default entry and the Data packs: each pack is its own subpath (ADR-0005).
    entry: [
      "src/index.ts",
      "src/data/countries.ts",
      "src/data/subdivisions.ts",
      "src/data/subdivisions/*.ts",
    ],
    dts: {
      generator: "tsgo",
    },
    // Workspace code resolves `geo-resolve` to its source through this condition;
    // the published exports (`publishConfig.exports`) point at `dist` only.
    exports: {
      devExports: "geo-resolve:source",
      // One pattern covers the per-Country Subdivisions packs, so a Country added by a data
      // release is exported without regenerating ~250 entries here.
      customExports(exports, { isPublish }) {
        const kept = Object.entries(exports).filter(
          ([subpath]) => !subpath.startsWith("./data/subdivisions/"),
        );
        const dist = "./dist/data/subdivisions/*.mjs";
        return Object.fromEntries([
          ...kept,
          [
            "./data/subdivisions/*",
            isPublish
              ? dist
              : { "geo-resolve:source": "./src/data/subdivisions/*.ts", default: dist },
          ],
        ]);
      },
    },
  },
  // Tests import the package by name, as a consumer does, and run against its source.
  ssr: {
    resolve: {
      conditions: ["geo-resolve:source", ...defaultServerConditions],
    },
  },
});
