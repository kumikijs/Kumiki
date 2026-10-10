import { filterByScope } from "@kumikijs/cli";
import type { KumikiError } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

const SCOPES = ["types", "refs", "effects"] as const;

function err(code: string, severity?: "warning"): KumikiError {
  const e: KumikiError = { code, kind: "k", message: "m", pos: { line: 1, col: 1 } };
  return severity ? { ...e, severity } : e;
}

const survives = (code: string, ...scopes: (typeof SCOPES)[number][]) =>
  filterByScope([err(code)], scopes).length === 1;

describe("filterByScope", () => {
  const ALWAYS = ["E0001", "E0002", "E0003", "E0004", "E0701", "E0704", "E0712", "E0801"];

  for (const scope of SCOPES) {
    it(`--${scope} keeps every code in a band no scope claims`, () => {
      const dropped = ALWAYS.filter((c) => !survives(c, scope));
      expect(dropped).toEqual([]);
    });

    it(`--${scope} keeps E0212, which is gated by --strict-selector-id`, () => {
      expect(survives("E0212", scope)).toBe(true);
    });

    it(`--${scope} keeps warnings`, () => {
      expect(filterByScope([err("W0212", "warning")], [scope])).toHaveLength(1);
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

  it("no scope is the identity", () => {
    const errors = [err("E0103"), err("E0003"), err("W0212", "warning")];
    expect(filterByScope(errors, [])).toBe(errors);
  });

  it("composes: two scopes keep the union of their bands", () => {
    expect(survives("E0103", "types", "refs")).toBe(true);
    expect(survives("E0201", "types", "refs")).toBe(true);
    expect(survives("E0301", "types", "refs")).toBe(false);
    expect(survives("E0301", "types", "refs", "effects")).toBe(true);
  });
});
