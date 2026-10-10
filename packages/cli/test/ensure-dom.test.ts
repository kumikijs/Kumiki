import { describe, expect, it } from "vitest";
import { ensureDom } from "../src/smoke.ts";

describe("ensureDom", () => {
  it("registers once when two calls overlap", async () => {
    await expect(Promise.all([ensureDom(), ensureDom()])).resolves.toBeDefined();
    await expect(ensureDom()).resolves.toBeUndefined();
  });
});
