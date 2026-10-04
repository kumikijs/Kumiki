// A property-test over a `Tuple` (testing.md §8.3.2): each generated pair is
// built element by element under its own refinements, so it is a value the
// `pair` slot accepts and the reducer runs on every trial. A pair the
// generator could not build, or a trial whose batch the slot refused, would
// fail these properties rather than let them hold over trials where nothing
// ran.
//
// The examples suite compiles example 230 and runs its scenario, but not its
// tests; this runs them through `kumiki test`'s path.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { testFile } from "@kumikijs/cli";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const EXAMPLE = join(here, "..", "examples", "features", "230-property-test-tuple.kumiki");

describe("a property-test over a Tuple", () => {
  it("runs the reducer on every generated pair", { timeout: 30_000 }, async () => {
    const results = await testFile(EXAMPLE);
    expect(results.map((r) => ({ name: r.name, pass: r.pass, cases: r.cases }))).toEqual([
      { name: "put-keeps-the-pair", pass: true, cases: 100 },
      { name: "put-counts-once", pass: true, cases: 100 },
      { name: "lower-keeps-the-label", pass: true, cases: 100 },
    ]);
  });
});
