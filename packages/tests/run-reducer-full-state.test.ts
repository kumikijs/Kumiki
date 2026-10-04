// A property-test invariant reads the state `run-reducer` answers, and that
// state is the whole slot table (testing.md §8.3.2): a slot the trial neither
// seeds nor writes reads its default, as it does in a reducer-test. A slot
// missing from it would read `undefined`, and the runner would report a
// counterexample against a correct reducer.
//
// Run through the real `kumiki test` path on example 193, so the chained form
// is lowered by codegen rather than called by hand.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { testFile } from "@kumikijs/cli";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const EXAMPLE = join(here, "..", "examples", "features", "193-run-reducer-full-state.kumiki");

describe("the state a property-test invariant reads through run-reducer", () => {
  it("holds every slot, at every step of a chain", { timeout: 30_000 }, async () => {
    const results = await testFile(EXAMPLE);
    expect(results.map((r) => `${r.name}:${r.pass}`)).toEqual([
      "label-keeps-its-default:true",
      "count-steps-by-one:true",
      "a-chain-keeps-every-slot:true",
      "the-route-is-in-the-table:true",
      "reducer-test-sees-the-default:true",
    ]);
  });
});
