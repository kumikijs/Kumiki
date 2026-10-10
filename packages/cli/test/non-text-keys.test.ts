import { feature } from "@kumikijs/examples";
import { describe, expect, it } from "vitest";
import { testFile } from "../src/smoke.ts";

const EXAMPLE = feature("102-non-text-keys");

describe("a key reader in a property-test invariant", () => {
  it("reads the keys back as the declared type", { timeout: 30_000 }, async () => {
    const results = await testFile(EXAMPLE);
    expect(results.map((r) => `${r.name}:${r.pass}`)).toEqual(["fill-adds-eight:true"]);
  });
});
