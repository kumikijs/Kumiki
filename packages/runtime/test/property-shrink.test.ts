// Shrinking a property-test counterexample (spec/testing.md §8.3.2) stays
// inside the domain the variable's descriptor declares — the same one the
// generator draws from. A candidate outside it is a value no trial could have
// been handed: `0` for an `Int where positive`, `""` for an `email`, a record
// with a field missing.
//
// A `run-reducer` step whose batch a refinement refuses leaves the state it
// was given (runtime.md §10.3.3). Shrinking does not take such a case as a
// smaller counterexample, and a generated case that is itself refused is
// reported as generated, with the refusal.

import type { GenDesc, ReducerSpec, TestResult } from "@kumikijs/runtime";
import { _stdlib } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** The bindings a failing property reports, and the note after them, if any. */
function counterexample(r: TestResult): { binds: Record<string, unknown>; note?: string } {
  expect(r.pass).toBe(false);
  const m = /^counterexample \(case \d+\/\d+\): (.*?)(?: — (.*))?$/.exec(r.actual ?? "");
  if (!m) throw new Error(`not a counterexample: ${r.actual}`);
  return {
    binds: JSON.parse(m[1] as string) as Record<string, unknown>,
    ...(m[2] !== undefined ? { note: m[2] } : {}),
  };
}

/** The test name, and so the seed, the two helpers below run `desc` under. */
const nameFor = (desc: GenDesc): string => `shrinks ${JSON.stringify(desc)}`;

/**
 * The value a property over `desc` that fails for every input is shrunk to —
 * the simplest value shrinking reaches inside the descriptor's domain.
 */
function shrunkFrom(desc: GenDesc): unknown {
  return counterexample(
    _stdlib.runPropertyTest({ name: nameFor(desc), vars: { v: desc }, trial: () => false }),
  ).binds.v;
}

/** The value {@link shrunkFrom} starts from: the first one generated for `desc`. */
function generatedFrom(desc: GenDesc): unknown {
  return counterexample(
    _stdlib.runPropertyTest({
      name: nameFor(desc),
      vars: { v: desc },
      trial: () => false,
      shrink: false,
    }),
  ).binds.v;
}

describe("a shrunk counterexample stays inside its descriptor", () => {
  it("shrinks a bounded Int toward the bound nearest zero", () => {
    expect(shrunkFrom({ t: "Int", min: 1 })).toBe(1);
    expect(shrunkFrom({ t: "Int", max: -1 })).toBe(-1);
    expect(shrunkFrom({ t: "Int", min: 5, max: 10 })).toBe(5);
    expect(shrunkFrom({ t: "Int", min: -10, max: -3 })).toBe(-3);
  });

  it("shrinks an Int whose range holds zero to zero, as an unbounded one", () => {
    expect(shrunkFrom({ t: "Int", min: -10, max: 10 })).toBe(0);
    expect(shrunkFrom({ t: "Int" })).toBe(0);
  });

  it("shrinks a positive Float to the smallest value the generator gives it", () => {
    expect(shrunkFrom({ t: "Float", min: Number.EPSILON })).toBe(Number.EPSILON);
    expect(shrunkFrom({ t: "Float", max: -Number.EPSILON })).toBe(-Number.EPSILON);
  });

  it("shrinks text to the shortest length its descriptor admits", () => {
    expect(shrunkFrom({ t: "Text", minLen: 1 })).toHaveLength(1);
    expect(shrunkFrom({ t: "Text", minLen: 4 })).toHaveLength(4);
    expect(shrunkFrom({ t: "Text", maxLen: 4 })).toBe("");
    expect(shrunkFrom({ t: "Text" })).toBe("");
  });

  it("leaves text of one fixed length at that length", () => {
    const desc: GenDesc = { t: "Text", minLen: 5, maxLen: 5 };
    expect(shrunkFrom(desc)).toBe(generatedFrom(desc));
    expect(shrunkFrom(desc)).toHaveLength(5);
  });

  it("shrinks an email to a shorter address of the shape it was generated in", () => {
    const desc: GenDesc = { t: "Text", form: "email" };
    const shrunk = shrunkFrom(desc) as string;
    expect(shrunk.length).toBeLessThan((generatedFrom(desc) as string).length);
    expect(shrunk).toMatch(/^[a-z]@[a-z]\.example\.com$/);
  });

  it("shrinks a url to a shorter one of the shape it was generated in", () => {
    const desc: GenDesc = { t: "Text", form: "url" };
    const shrunk = shrunkFrom(desc) as string;
    expect(shrunk.length).toBeLessThan((generatedFrom(desc) as string).length);
    expect(shrunk).toMatch(/^https:\/\/[a-z]\.example\.com\/[a-z]$/);
  });

  it("leaves a uuid as generated, since no shorter text is one", () => {
    const desc: GenDesc = { t: "Text", form: "uuid" };
    expect(shrunkFrom(desc)).toBe(generatedFrom(desc));
  });

  it("shrinks a one-of value toward the first listed literal", () => {
    expect(shrunkFrom({ t: "Text", oneOf: ["sm", "md", "lg"] })).toBe("sm");
    expect(shrunkFrom({ t: "Int", oneOf: [3, 5, 9] })).toBe(3);
    expect(shrunkFrom({ t: "Text", oneOf: ["only"] })).toBe("only");
  });

  it("shrinks a one-of value only to a literal listed before it", () => {
    // Fails for "md" and "lg" alone: "sm" is the one simpler candidate, and it holds.
    const r = _stdlib.runPropertyTest({
      name: "one-of-stops-at-md",
      vars: { v: { t: "Text", oneOf: ["sm", "md", "lg"] } },
      trial: (b) => b.v === "sm",
    });
    expect(counterexample(r).binds.v).toBe("md");
  });

  it("shrinks a record field by field, keeping every field", () => {
    const desc: GenDesc = {
      t: "Record",
      fields: [
        { name: "a", desc: { t: "Int", min: 1 } },
        { name: "b", desc: { t: "Text", minLen: 1 } },
        { name: "c", desc: { t: "Int" } },
      ],
    };
    const shrunk = shrunkFrom(desc) as Record<string, unknown>;
    expect(Object.keys(shrunk)).toEqual(["a", "b", "c"]);
    expect(shrunk.a).toBe(1);
    expect(shrunk.b).toHaveLength(1);
    expect(shrunk.c).toBe(0);
  });

  it("shrinks a record nested in a record inside its own descriptor", () => {
    const desc: GenDesc = {
      t: "Record",
      fields: [
        {
          name: "inner",
          desc: { t: "Record", fields: [{ name: "n", desc: { t: "Int", min: 5, max: 9 } }] },
        },
      ],
    };
    expect(shrunkFrom(desc)).toEqual({ inner: { n: 5 } });
  });

  it("keeps the elements a list of refined values shrinks to", () => {
    // The list loses elements; the ones it keeps are ones the generator built.
    const r = _stdlib.runPropertyTest({
      name: "list-of-positive",
      vars: { xs: { t: "List", elem: { t: "Int", min: 1 } } },
      trial: (b) => (b.xs as number[]).length < 2,
    });
    const xs = counterexample(r).binds.xs as number[];
    expect(xs).toHaveLength(2);
    for (const x of xs) expect(x).toBeGreaterThanOrEqual(1);
  });

  it("hands the trial no value outside the descriptor, generated or shrunk", () => {
    const descs: [GenDesc, (v: unknown) => boolean][] = [
      [{ t: "Int", min: 1 }, (v) => typeof v === "number" && v >= 1],
      [{ t: "Int", max: -1 }, (v) => typeof v === "number" && v <= -1],
      [{ t: "Float", min: Number.EPSILON }, (v) => typeof v === "number" && v > 0],
      [{ t: "Text", minLen: 3 }, (v) => typeof v === "string" && v.length >= 3],
      [{ t: "Text", form: "email" }, (v) => typeof v === "string" && /^\S+@\S+\.\S+$/.test(v)],
      [{ t: "Text", oneOf: ["a", "b", "c"] }, (v) => v === "a" || v === "b" || v === "c"],
    ];
    for (const [desc, accepts] of descs) {
      const outside: unknown[] = [];
      _stdlib.runPropertyTest({
        name: `inside ${JSON.stringify(desc)}`,
        vars: { v: desc },
        trial: (b) => {
          if (!accepts(b.v)) outside.push(b.v);
          return false;
        },
      });
      expect(outside, JSON.stringify(desc)).toEqual([]);
    }
  });
});

describe("a value with no refinement shrinks by the plain candidates", () => {
  // A type with nothing to honour is shrunk toward zero, the empty text and
  // the empty collection, halving on the way. Pinned by the counterexample each
  // reports for its seed.
  it("an Int halves toward zero", () => {
    const r = _stdlib.runPropertyTest({
      name: "int-unconstrained",
      vars: { v: { t: "Int" } },
      trial: (b) => (b.v as number) < 5,
    });
    expect(counterexample(r).binds).toEqual({ v: 6 });
  });

  it("a Text halves toward the empty string", () => {
    const r = _stdlib.runPropertyTest({
      name: "text-unconstrained",
      vars: { v: { t: "Text" } },
      trial: (b) => (b.v as string).length < 3,
    });
    expect(counterexample(r).binds).toEqual({ v: "pdV" });
  });

  it("a List loses elements and keeps the rest as generated", () => {
    const r = _stdlib.runPropertyTest({
      name: "list-plain",
      vars: { xs: { t: "List", elem: { t: "Int" } } },
      trial: (b) => (b.xs as unknown[]).length < 3,
    });
    expect(counterexample(r).binds).toEqual({ xs: [-286, 675, -795] });
  });

  it("a Bool is reported as generated", () => {
    const r = _stdlib.runPropertyTest({
      name: "bool-plain",
      vars: { v: { t: "Bool" } },
      trial: (b) => b.v === true,
    });
    expect(counterexample(r).binds).toEqual({ v: false });
  });
});

describe("a run-reducer batch a refinement refuses", () => {
  let errors: string[];
  beforeEach(() => {
    errors = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** `count` is held to `between(0, 100)`; `dec` takes `step` (1 unless given) off it. */
  const app = {
    live: {} as Record<string, unknown>,
    slots: {
      count: {
        value: 0,
        refine: (v: unknown) => typeof v === "number" && v >= 0 && v <= 100,
        refineKind: "between",
        refineArgs: [0, 100],
      },
      step: { value: 1 },
    },
    reducers: [
      {
        name: "dec",
        event: { kind: "ui", ev: "click" },
        apply: (live: Record<string, unknown>) => ({
          slots: { count: (live.count as number) - (live.step as number) },
          emits: [],
        }),
      } as ReducerSpec,
    ],
  };
  const decFrom = (n: unknown, step?: unknown): number =>
    _stdlib.runReducerStep(
      app,
      { slots: step === undefined ? { count: n } : { count: n, step } },
      "dec",
      {},
    ).slots.count as number;

  it("is not taken as a smaller counterexample", () => {
    // Fails for every n in 1..11, where `dec` commits 0..10. At n = 0 the batch
    // is refused and the state stays 0, which fails the invariant too — but the
    // reducer committed nothing there, so the smallest counterexample is 1.
    const r = _stdlib.runPropertyTest({
      name: "dec-stays-above-ten",
      vars: { n: { t: "Int", min: 0, max: 100 } },
      trial: (b) => decFrom(b.n) > 10,
    });
    expect(counterexample(r)).toEqual({ binds: { n: 1 } });
  });

  it("reports a generated case that is itself refused as generated, with the refusal", () => {
    const r = _stdlib.runPropertyTest({
      name: "dec-subtracts-one",
      vars: { n: { t: "Int", min: 0, max: 0 } },
      trial: (b) => decFrom(b.n) === (b.n as number) - 1,
    });
    expect(counterexample(r)).toEqual({
      binds: { n: 0 },
      note: 'reducer "dec" was rejected: slot "count" cannot hold -1 (between(0, 100))',
    });
  });

  it("does not shrink a refused case toward one that commits", () => {
    // From 10, `dec` commits for steps 1..10 and is refused past them. The
    // invariant fails on every step but 3, so a committed counterexample is
    // one candidate away from the refused one generated first.
    const property = (shrink: boolean): TestResult =>
      _stdlib.runPropertyTest({
        name: "dec-from-ten-lands-on-seven",
        vars: { s: { t: "Int", min: 1, max: 50 } },
        trial: (b) => decFrom(10, b.s) === 7,
        shrink,
      });
    const generated = counterexample(property(false));
    const s = generated.binds.s as number;
    expect(s).toBeGreaterThan(10);
    expect(counterexample(property(true))).toEqual({
      binds: { s },
      note: `reducer "dec" was rejected: slot "count" cannot hold ${10 - s} (between(0, 100))`,
    });
  });

  it("leaves a trial whose invariant holds over the refused state passing", () => {
    const r = _stdlib.runPropertyTest({
      name: "dec-floors-at-zero",
      vars: { n: { t: "Int", min: 0, max: 3 } },
      trial: (b) => decFrom(b.n) === Math.max((b.n as number) - 1, 0),
    });
    expect(r.pass).toBe(true);
    expect(errors.some((e) => e.includes('reducer "dec" was rejected'))).toBe(true);
  });
});
