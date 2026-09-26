// A property-test invariant reads the state `run-reducer` answers, and a key
// reader on it (`run-reducer(fill).slots.tags.to-list`) has to restore keys
// the way the same read in a reducer does (stdlib.md §2.2.2). The invariant
// used to read `["10", "8"]` from a `Set(Int)`, so `contains(8)` was false and
// the runner reported a counterexample against a program that is correct —
// blaming the code under test for the checker not knowing the state's type.
//
// Run through the real `kumiki test` path on example 102, whose scenario
// covers the same reads in a reducer.

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
