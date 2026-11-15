import { testFile } from "@kumikijs/cli";
import { feature } from "@kumikijs/examples";
import { describe, expect, it } from "vitest";

describe("the state a property-test invariant reads through run-reducer", () => {
  it("holds every slot, at every step of a chain", { timeout: 30_000 }, async () => {
    const results = await testFile(feature("193-run-reducer-full-state"));
    expect(results.map((r) => `${r.name}:${r.pass}`)).toEqual([
      "label-keeps-its-default:true",
      "count-steps-by-one:true",
      "a-chain-keeps-every-slot:true",
      "the-route-is-in-the-table:true",
      "reducer-test-sees-the-default:true",
    ]);
  });
});
