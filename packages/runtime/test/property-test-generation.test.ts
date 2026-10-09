// What a property-test trial is run on (testing.md §8.3.2): every generated
// value is a value of its `for-all` type — a tuple element by element, a
// recursive type to a bounded depth — and so is every value the shrinker
// offers in its place. A descriptor the generator does not know is an error,
// never a `null` standing in for a value.
//
// The descriptors are the ones codegen emits for the types named in each test
// (`forAllGenerator`, compiler/src/codegen/emit-type.ts); the CLI's
// property-test-generation.test.ts runs the same types through a compiled
// program.

import { _stdlib, type GenDesc, type ReducerSpec } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";

/** A seeded stream, so a failure here reproduces. */
function rng(seed = 7): () => number {
  let a = seed;
  return () => {
    a = (a * 1103515245 + 12345) & 0x7fffffff;
    return a / 0x7fffffff;
  };
}

/** `count` generated values of `desc`. */
function generate(desc: GenDesc, count = 200): unknown[] {
  const next = rng();
  return Array.from({ length: count }, () => _stdlib.genValue(desc, next));
}

/** `type Tree = Leaf | Node(Int, Tree)` */
const TREE: GenDesc = {
  t: "Fix",
  name: "Tree",
  body: {
    t: "Union",
    variants: [
      { name: "Leaf", payloads: [] },
      { name: "Node", payloads: [{ t: "Int" }, { t: "Rec", name: "Tree" }] },
    ],
    base: [0],
  },
};

/** `type Chain = {v: Int, next: Option(Chain)}` */
const CHAIN: GenDesc = {
  t: "Fix",
  name: "Chain",
  body: {
    t: "Record",
    fields: [
      { name: "v", desc: { t: "Int" } },
      { name: "next", desc: { t: "Option", inner: { t: "Rec", name: "Chain" } } },
    ],
  },
};

/** `type Rose = {v: Int, kids: List(Rose)}` */
const ROSE: GenDesc = {
  t: "Fix",
  name: "Rose",
  body: {
    t: "Record",
    fields: [
      { name: "v", desc: { t: "Int" } },
      { name: "kids", desc: { t: "List", elem: { t: "Rec", name: "Rose" } } },
    ],
  },
};

/** How many `Node`s deep a `Tree` goes, or `undefined` for a value that is not one. */
function treeDepth(v: unknown): number | undefined {
  const node = v as { _tag?: unknown; _0?: unknown; _1?: unknown } | null;
  if (node?._tag === "Leaf") return 0;
  if (node?._tag !== "Node" || typeof node._0 !== "number") return undefined;
  const rest = treeDepth(node._1);
  return rest === undefined ? undefined : rest + 1;
}

/** How many links a `Chain` has, or `undefined` for a value that is not one. */
function chainLength(v: unknown): number | undefined {
  const link = v as { v?: unknown; next?: { _tag?: unknown; _0?: unknown } } | null;
  if (typeof link?.v !== "number") return undefined;
  if (link.next?._tag === "None") return 1;
  if (link.next?._tag !== "Some") return undefined;
  const rest = chainLength(link.next._0);
  return rest === undefined ? undefined : rest + 1;
}

/** How many levels a `Rose` has, or `undefined` for a value that is not one. */
function roseHeight(v: unknown): number | undefined {
  const rose = v as { v?: unknown; kids?: unknown } | null;
  if (typeof rose?.v !== "number" || !Array.isArray(rose.kids)) return undefined;
  let tallest = 0;
  for (const kid of rose.kids) {
    const h = roseHeight(kid);
    if (h === undefined) return undefined;
    tallest = Math.max(tallest, h);
  }
  return tallest + 1;
}

describe("a generated value is a value of its for-all type", () => {
  it("builds a Tuple element by element, each honouring its own refinement", () => {
    // `Tuple(Text where nonempty, Int where negative)`
    const values = generate({
      t: "Tuple",
      items: [
        { t: "Text", minLen: 1 },
        { t: "Int", max: -1 },
      ],
    });
    for (const v of values) {
      expect(Array.isArray(v) && v.length === 2, JSON.stringify(v)).toBe(true);
      const [label, n] = v as [unknown, unknown];
      expect(typeof label === "string" && label.length > 0, JSON.stringify(v)).toBe(true);
      expect(typeof n === "number" && n < 0, JSON.stringify(v)).toBe(true);
    }
  });

  it("keys a Map by a Tuple the way the runtime keys one", () => {
    // `Map(Tuple(Int, Int), Text)`: an entry put there by `insert` is keyed by
    // the pair's JSON, so a generated key that reads otherwise is one no
    // lookup in the program under test could find.
    const values = generate({
      t: "Map",
      key: { t: "Tuple", items: [{ t: "Int" }, { t: "Int" }] },
      val: { t: "Text" },
    });
    const keys = values.flatMap((m) => Object.keys(m as Record<string, unknown>));
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) expect(k).toMatch(/^\[-?\d+,-?\d+\]$/);
  });

  it("generates a recursive union to a bounded depth, every level a value of it", () => {
    const depths = generate(TREE).map(treeDepth);
    expect(depths).not.toContain(undefined);
    // The recursive variant is taken, and the depth bound (four levels) ends it.
    expect(Math.max(...(depths as number[]))).toBeGreaterThanOrEqual(2);
    expect(Math.max(...(depths as number[]))).toBeLessThanOrEqual(4);
  });

  it("ends a record that recurses through an Option at None", () => {
    const lengths = generate(CHAIN).map(chainLength);
    expect(lengths).not.toContain(undefined);
    expect(Math.max(...(lengths as number[]))).toBeGreaterThanOrEqual(2);
    expect(Math.max(...(lengths as number[]))).toBeLessThanOrEqual(5);
  });

  it("ends a record that recurses through a List at the empty list", () => {
    const heights = generate(ROSE, 50).map(roseHeight);
    expect(heights).not.toContain(undefined);
    expect(Math.max(...(heights as number[]))).toBeGreaterThanOrEqual(2);
    expect(Math.max(...(heights as number[]))).toBeLessThanOrEqual(5);
  });

  it("refuses a descriptor it has no generator for, rather than answering null", () => {
    expect(() => _stdlib.genValue({ t: "Opaque" } as unknown as GenDesc, rng())).toThrow(
      /no generator/,
    );
  });
});

describe("a shrunk counterexample is a value of its for-all type", () => {
  /** The counterexample a property that never holds is shrunk to. */
  function minimal(vars: Record<string, GenDesc>, shrink = true): unknown {
    const r = _stdlib.runPropertyTest({ name: "never", vars, trial: () => false, seed: 3, shrink });
    expect(r.pass).toBe(false);
    return JSON.parse((r.actual ?? "").replace(/^counterexample \(case \d+\/\d+\): /, ""));
  }

  it("shrinks a form to a shorter value of the shape it was generated in", () => {
    const { e } = minimal({ e: { t: "Text", form: "email" } }) as { e: string };
    expect(e).toMatch(/^[a-z]@[a-z]\.example\.com$/);
    const { u } = minimal({ u: { t: "Text", form: "url" } }) as { u: string };
    expect(u).toMatch(/^https:\/\/[a-z]\.example\.com\/[a-z]$/);
    // A uuid's shape fixes its length, so no shorter text is one.
    const uuid: Record<string, GenDesc> = { id: { t: "Text", form: "uuid" } };
    expect(minimal(uuid)).toEqual(minimal(uuid, false));
  });

  it("shrinks a one-of value through the literals listed before it", () => {
    // Fails on every literal but the first, so the one before the generated
    // value is a smaller counterexample even though the first is not.
    const vars: Record<string, GenDesc> = { size: { t: "Text", oneOf: ["xs", "sm", "md", "lg"] } };
    const property = (shrink: boolean) =>
      _stdlib.runPropertyTest({
        name: "only-xs",
        vars,
        trial: (b) => b.size === "xs",
        shrink,
      });
    expect(property(false).actual).toMatch(/\{"size":"(md|lg)"\}$/);
    expect(property(true).actual).toMatch(/\{"size":"sm"\}$/);
  });

  it("shrinks a bounded Int toward zero without leaving its bounds", () => {
    expect(minimal({ n: { t: "Int", min: 1, max: 9 } })).toEqual({ n: 1 });
    expect(minimal({ n: { t: "Int", max: -1 } })).toEqual({ n: -1 });
    expect(minimal({ n: { t: "Int" } })).toEqual({ n: 0 });
  });

  it("shrinks a length-bounded Text to its shortest length, not to the empty one", () => {
    const { s } = minimal({ s: { t: "Text", minLen: 2 } }) as { s: string };
    expect(s).toHaveLength(2);
  });

  it("shrinks a Tuple element by element and keeps its arity", () => {
    const { p } = minimal({
      p: {
        t: "Tuple",
        items: [
          { t: "Text", minLen: 1 },
          { t: "Int", max: -1 },
        ],
      },
    }) as { p: unknown[] };
    expect(p).toHaveLength(2);
    expect((p[0] as string).length).toBe(1);
    expect(p[1]).toBe(-1);
  });

  it("shrinks a record field by field and keeps every field", () => {
    expect(
      minimal({
        r: {
          t: "Record",
          fields: [
            { name: "a", desc: { t: "Int", min: 5, max: 9 } },
            { name: "b", desc: { t: "Text" } },
          ],
        },
      }),
    ).toEqual({ r: { a: 5, b: "" } });
  });
});

// testing.md §8.3.1: the reducer did not run, so the trial has no state to
// check the invariant against.
describe("a trial whose run-reducer batch is rejected fails", () => {
  type StepApp = Parameters<typeof _stdlib.runReducerStep>[0];

  /** `slot <name> : Int where between(lo, hi)`, as codegen emits it, and one reducer. */
  function appWith(name: string, [lo, hi]: [number, number], reducer: ReducerSpec): StepApp {
    return {
      live: {},
      slots: {
        [name]: {
          value: lo,
          refine: (v) => typeof v === "number" && v >= lo && v <= hi,
          refineKind: "between",
          refineArgs: [lo, hi],
        },
      },
      reducers: [reducer],
    };
  }

  const inc: ReducerSpec = {
    name: "inc",
    event: { kind: "ui", ev: "click" },
    apply: (live) => ({ slots: { count: (live.count as number) + 1 }, emits: [] }),
  };

  /** `invariant = run-reducer(inc).slots.count >= 0`, which holds whenever `inc` runs. */
  function property(vars: Record<string, GenDesc>) {
    const app = appWith("count", [0, 3], inc);
    return _stdlib.runPropertyTest({
      name: "inc-keeps-count-in-range",
      vars,
      trial: (b) => {
        const after = _stdlib.runReducerStep(app, { slots: { count: b.n } }, "inc", {});
        return (after.slots.count as number) >= 0;
      },
    });
  }

  it("fails the property, naming the reducer and the rejection", () => {
    // `n = 3` is the one value `inc` cannot take further: the trial cannot hold
    // when the reducer did not run.
    const r = property({ n: { t: "Int", min: 0, max: 3 } });
    expect(r.pass).toBe(false);
    expect(r.actual).toMatch(/^counterexample \(case \d+\/100\): \{"n":3\}/);
    expect(r.actual).toContain(
      'reducer "inc" was rejected: slot "count" cannot hold 4 (between(0, 3))',
    );
  });

  it("leaves a property whose reducer commits on every trial passing", () => {
    const r = property({ n: { t: "Int", min: 0, max: 2 } });
    expect(r).toMatchObject({ pass: true, cases: 100 });
  });

  it("shrinks within the for-all type, so a rejection it reports is one a trial met", () => {
    // `level : Int where between(1, 3)`, and `keep` writes it back unchanged.
    // The invariant fails from 2 up, which is the counterexample to report.
    // Shrinking `n` toward 0 would hand `keep` a value the generator never
    // produces and the slot refuses, and the report would blame that refusal.
    const app = appWith("level", [1, 3], {
      name: "keep",
      event: { kind: "ui", ev: "click" },
      apply: (live) => ({ slots: { level: live.level }, emits: [] }),
    });
    const r = _stdlib.runPropertyTest({
      name: "stays-below-two",
      vars: { n: { t: "Int", min: 1, max: 3 } },
      trial: (b) => {
        const after = _stdlib.runReducerStep(app, { slots: { level: b.n } }, "keep", {});
        return (after.slots.level as number) < 2;
      },
    });
    expect(r.pass).toBe(false);
    expect(r.actual).toMatch(/^counterexample \(case \d+\/100\): \{"n":2\}$/);
  });

  // `count : Int where between(0, 100)` and `take` subtracts `step` from it,
  // so it is refused exactly when `step` is more than `count`.
  const take: ReducerSpec = {
    name: "take",
    event: { kind: "ui", ev: "click" },
    apply: (live) => ({
      slots: { count: (live.count as number) - (live.step as number) },
      emits: [],
    }),
  };
  const takeApp = (): StepApp => {
    const app = appWith("count", [0, 100], take);
    app.slots.step = { value: 1 };
    return app;
  };
  /** What `count` is after `take` runs on `count` and `step`; throws when it is refused. */
  const after = (app: StepApp, count: unknown, step: unknown): number =>
    _stdlib.runReducerStep(app, { slots: { count, step } }, "take", {}).slots.count as number;

  it("shrinks an invariant failure only through trials in which every step ran", () => {
    // Fails wherever `take` leaves 10 or less: n in 1..11, where the reducer
    // commits 0..10. At n = 0 it is refused — a failure of another kind, and
    // not a smaller case of this one.
    const app = takeApp();
    const r = _stdlib.runPropertyTest({
      name: "take-stays-above-ten",
      vars: { n: { t: "Int", min: 0, max: 100 } },
      trial: (b) => after(app, b.n, 1) > 10,
    });
    expect(r.actual).toMatch(/^counterexample \(case \d+\/100\): \{"n":1\}$/);
  });

  it("shrinks a refused trial only among trials refused the same way", () => {
    // From 10, `take` commits for steps 1..10 and is refused past them. The
    // invariant fails on every step but 3, so the step-1 trial fails too —
    // with every step run, which is not the failure the refused case reports.
    const app = takeApp();
    const property = (shrink: boolean) =>
      _stdlib.runPropertyTest({
        name: "take-from-ten-lands-on-seven",
        vars: { s: { t: "Int", min: 1, max: 50 } },
        trial: (b) => after(app, 10, b.s) === 7,
        shrink,
      });
    const generated = /\{"s":(\d+)\}/.exec(property(false).actual ?? "")?.[1];
    const m = /^counterexample \(case \d+\/100\): \{"s":(\d+)\} — (.*)$/.exec(
      property(true).actual ?? "",
    );
    const s = Number(m?.[1]);
    expect(s).toBeGreaterThan(10);
    expect(s).toBeLessThan(Number(generated));
    expect(m?.[2]).toBe(
      `reducer "take" was rejected: slot "count" cannot hold ${10 - s} (between(0, 100))`,
    );
  });

  it("does not shrink a refused trial toward one refused for another slot", () => {
    // `split` writes `10 - s` to `low` and `s - 20` to `high`, both held to
    // `between(0, 100)`: `low` refuses s above 10 and `high` s below 20, so
    // every trial is refused, by `low`, by `high`, or by both.
    const between = (v: unknown) => typeof v === "number" && v >= 0 && v <= 100;
    const slot = { value: 0, refine: between, refineKind: "between", refineArgs: [0, 100] };
    const app: StepApp = {
      live: {},
      slots: { low: slot, high: slot, s: { value: 0 } },
      reducers: [
        {
          name: "split",
          event: { kind: "ui", ev: "click" },
          apply: (live) => ({
            slots: { low: 10 - (live.s as number), high: (live.s as number) - 20 },
            emits: [],
          }),
        },
      ],
    };
    const property = (shrink: boolean) =>
      _stdlib.runPropertyTest({
        name: "split-is-refused",
        vars: { s: { t: "Int", min: 1, max: 50 } },
        trial: (b) => {
          _stdlib.runReducerStep(app, { slots: { s: b.s } }, "split", {});
          return true;
        },
        shrink,
      });
    // The generated case is refused by `low` alone. Every candidate toward 1
    // is refused by `high`, alone or with `low`, so none is a smaller case of
    // the failure it reports.
    const generated = property(false).actual;
    expect(generated).toMatch(/— reducer "split" was rejected: slot "low" cannot hold -\d+ \(/);
    expect(generated).not.toContain('slot "high"');
    expect(property(true).actual).toBe(generated);
  });
});
