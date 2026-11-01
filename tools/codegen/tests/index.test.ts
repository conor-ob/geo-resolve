import { expect, test } from "vite-plus/test";

test("the codegen entry loads", async () => {
  await expect(import("../src/index.ts")).resolves.toBeDefined();
});
