import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    dts: {
      generator: "tsgo",
    },
    exports: true,
  },
  resolve: {
    // Tests import the package by name, as a consumer does, and run against its source.
    alias: [
      {
        find: /^geo-resolve$/,
        replacement: fileURLToPath(new URL("./src/index.ts", import.meta.url)),
      },
    ],
  },
});
