import { expect, test } from "vite-plus/test";

test("the package entry loads", async () => {
  await expect(import("../src/index.ts")).resolves.toBeDefined();
});
