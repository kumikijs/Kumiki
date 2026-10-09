import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { testFile } from "../src/smoke.ts";

const here = dirname(fileURLToPath(import.meta.url));
const EXAMPLE = resolve(here, "../../examples/features/102-non-text-keys.kumiki");

describe("a key reader in a property-test invariant", () => {
  it("reads the keys back as the declared type", { timeout: 30_000 }, async () => {
    const results = await testFile(EXAMPLE);
    expect(results.map((r) => `${r.name}:${r.pass}`)).toEqual(["fill-adds-eight:true"]);
  });
});
