import { defaultServerConditions, defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    dts: {
      generator: "tsgo",
    },
    // Workspace code resolves `geo-resolve` to its source through this condition;
    // the published exports (`publishConfig.exports`) point at `dist` only.
    exports: { devExports: "geo-resolve:source" },
  },
  // Tests import the package by name, as a consumer does, and run against its source.
  ssr: {
    resolve: {
      conditions: ["geo-resolve:source", ...defaultServerConditions],
    },
  },
});
