import { testFile } from "@kumikijs/cli";
import { feature } from "@kumikijs/examples";
import { describe, expect, it } from "vitest";

const EXAMPLE = feature("304-mocked-result-reads-its-key");

describe("a mocked effect result's reducer reads the key of the emit it answers", () => {
  it("runs the example's tests as written", async () => {
    const results = await testFile(EXAMPLE);
    expect(results.map((r) => [r.name, r.pass, r.pass ? "" : r.actual])).toEqual([
      ["each-result-reads-its-own-key", true, ""],
      ["a-failed-result-reads-its-key", true, ""],
    ]);
  });
});
