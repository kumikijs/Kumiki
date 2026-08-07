// `kumiki check --types/--refs/--effects` narrows along one axis: what kind of
// mistake a diagnostic describes. Three bands are not on that axis — E00
// structure, E07 opt-in checks and testing-DSL invariants, E08 runtime hazards
// — so no scope selects them, and a filter that drops what no scope can ask
// for turns every narrowing flag into a hole. The end-to-end coverage in
// cli.test.ts reaches this through `npx tsx` at ~3s per case, which is why it
// only exercises a couple of codes; this covers the whole table directly.

import { filterByScope } from "@kumikijs/cli";
import type { KumikiError } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

const SCOPES = ["types", "refs", "effects"] as const;

function err(code: string, severity?: "warning"): KumikiError {
  const e: KumikiError = { code, kind: "k", message: "m", pos: { line: 1, col: 1 } };
  return severity ? { ...e, severity } : e;
}

const survives = (code: string, scope: (typeof SCOPES)[number]) =>
  filterByScope([err(code)], scope).length === 1;

describe("filterByScope", () => {
  // Literal here rather than imported from the implementation: a test that
  // reads the same list it is checking would pass however that list changes.
  const ALWAYS = ["E0001", "E0002", "E0003", "E0004", "E0701", "E0704", "E0712", "E0801"];

  for (const scope of SCOPES) {
    it(`--${scope} keeps every code in a band no scope claims`, () => {
      const dropped = ALWAYS.filter((c) => !survives(c, scope));
      expect(dropped).toEqual([]);
    });

    it(`--${scope} keeps E0212, which is gated by --strict-selector-id`, () => {
      // E0212 sits in E02, which `--types` claims anyway — so only `--refs`
      // and `--effects` actually depend on the strict-code allowlist.
      expect(survives("E0212", scope)).toBe(true);
    });

    it(`--${scope} keeps warnings`, () => {
      expect(filterByScope([err("W0212", "warning")], scope)).toHaveLength(1);
    });
  }

  it("still narrows: each scope drops the bands the others own", () => {
    const byScope = Object.fromEntries(
      SCOPES.map((s) => [
        s,
        ["E0103", "E0201", "E0301", "E0401", "E0601"].filter((c) => survives(c, s)),
      ]),
    );
    expect(byScope).toEqual({
      types: ["E0201", "E0401", "E0601"],
      refs: ["E0103"],
      effects: ["E0301"],
    });
  });

  it("`all` is the identity", () => {
    const errors = [err("E0103"), err("E0003"), err("W0212", "warning")];
    expect(filterByScope(errors, "all")).toBe(errors);
  });
});
