import { testFile } from "@kumikijs/cli";
import { feature } from "@kumikijs/examples";
import { describe, expect, it } from "vitest";

describe("a property-test over a Tuple", () => {
  it("runs the reducer on every generated pair", async () => {
    const results = await testFile(feature("230-property-test-tuple"));
    expect(results.map((r) => ({ name: r.name, pass: r.pass, cases: r.cases }))).toEqual([
      { name: "put-keeps-the-pair", pass: true, cases: 100 },
      { name: "put-counts-once", pass: true, cases: 100 },
      { name: "lower-keeps-the-label", pass: true, cases: 100 },
    ]);
  });
});
