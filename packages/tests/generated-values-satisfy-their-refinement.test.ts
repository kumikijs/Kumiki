// The generator and the runtime gate answer the same question from opposite
// ends, and nothing held them to the same answer.
//
// `email` / `url` / `uuid` fold into generation as a *shape* and into the
// runtime as a regex (#352). The two live in different packages — the shape in
// `@kumikijs/runtime`'s `genValue`, the pattern in the compiler's refinement
// table — so either could change and stay green while a `for-all` over `Email`
// generated values the slot it is generating for would refuse. That is the
// state testing.md §8.3.2 says cannot happen, stated here as an assertion.
//
// Shrinking a counterexample proposes values too, and is held to the same
// check: every candidate it tries, and the value it settles on, has to pass
// the predicate the generator honoured — or the counterexample reported is a
// value no trial could have been generated with.

import { applyRefine, type GenDescData, refinementToJs } from "@kumikijs/compiler";
import { _stdlibTest, type GenDesc } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";

const NO_POS = { line: 0, col: 0 };
const refinement = (pred: string, args: (number | string)[] = []) =>
  ({ kind: "Refinement", pred, args, pos: NO_POS }) as const;

/** The predicate a slot of this refinement is gated by, as a callable. */
function predicate(pred: string, args: (number | string)[] = []): (v: unknown) => boolean {
  const js = refinementToJs(refinement(pred, args));
  if (js === undefined) throw new Error(`"${pred}" lowers to nothing`);
  return new Function(`return (${js});`)() as (v: unknown) => boolean;
}

/** The descriptor codegen emits for that refinement over `base`. */
const descriptor = (base: GenDescData, pred: string, args: (number | string)[] = []): GenDesc =>
  applyRefine(base, refinement(pred, args)) as unknown as GenDesc;

/**
 * 200 generated values, each asserted against the predicate. Run through the
 * runner the language's own `property-test` uses rather than a loop of our
 * own, so the seeding and the descriptor reading are the real ones.
 */
function generatedValuesPass(desc: GenDesc, accepts: (v: unknown) => boolean): string | undefined {
  const report = _stdlibTest.runPropertyTest({
    name: `generated ${JSON.stringify(desc)}`,
    vars: { v: desc },
    trial: (binds) => accepts(binds.v),
    count: 200,
    shrink: false,
  });
  return report.pass ? undefined : report.actual;
}

describe("a generated value passes the check the runtime applies to a write", () => {
  for (const pred of ["email", "url", "uuid"] as const) {
    it(`generates a ${pred} its own predicate accepts`, () => {
      const desc = descriptor({ t: "Text" }, pred);
      expect(desc).toMatchObject({ t: "Text", form: pred });
      expect(generatedValuesPass(desc, predicate(pred))).toBeUndefined();
    });
  }

  it("draws a one-of value from the listed literals", () => {
    const desc = descriptor({ t: "Text" }, "one-of", ["sm", "md", "lg"]);
    expect(generatedValuesPass(desc, predicate("one-of", ["sm", "md", "lg"]))).toBeUndefined();
  });

  it("draws a numeric one-of from its own literals", () => {
    const desc = descriptor({ t: "Int" }, "one-of", [1, 2, 3]);
    expect(generatedValuesPass(desc, predicate("one-of", [1, 2, 3]))).toBeUndefined();
  });

  // `positive` on a Float is the arm where a bound of 0 would hand the check
  // the one value it refuses, and `negative` had no arm at all before #352.
  const numeric: [string, GenDescData][] = [
    ["positive", { t: "Int" }],
    ["positive", { t: "Float" }],
    ["negative", { t: "Int" }],
    ["negative", { t: "Float" }],
  ];
  for (const [pred, base] of numeric) {
    it(`generates a ${String(base.t)} the ${pred} check accepts`, () => {
      expect(generatedValuesPass(descriptor(base, pred), predicate(pred))).toBeUndefined();
    });
  }

  // The bounds that were already folded in, so the guard covers the whole set
  // rather than only what this change added.
  it("keeps the bounded and length-refined arms honest too", () => {
    expect(
      generatedValuesPass(
        descriptor({ t: "Int" }, "between", [0, 11]),
        predicate("between", [0, 11]),
      ),
    ).toBeUndefined();
    expect(
      generatedValuesPass(descriptor({ t: "Text" }, "nonempty"), predicate("nonempty")),
    ).toBeUndefined();
    expect(
      generatedValuesPass(descriptor({ t: "Text" }, "len-gt", [3]), predicate("len-gt", [3])),
    ).toBeUndefined();
  });
});

/**
 * Every value a property over `desc` hands its trial — the generated one first,
 * then each candidate shrinking tries — the ones the predicate refuses, and
 * the counterexample shrinking settles on. The trial fails every time, so
 * shrinking runs all the way to the simplest value it will propose.
 */
function shrinkPath(
  desc: GenDesc,
  accepts: (v: unknown) => boolean,
): { tried: unknown[]; refused: unknown[]; settled: unknown } {
  const tried: unknown[] = [];
  const report = _stdlibTest.runPropertyTest({
    name: `shrunk ${JSON.stringify(desc)}`,
    vars: { v: desc },
    trial: (binds) => {
      tried.push(binds.v);
      return false;
    },
  });
  const settled = /^counterexample \(case \d+\/\d+\): (.*)$/.exec(report.actual ?? "")?.[1];
  if (settled === undefined) throw new Error(`not a counterexample: ${report.actual}`);
  return {
    tried,
    refused: tried.filter((v) => !accepts(v)),
    settled: (JSON.parse(settled) as { v: unknown }).v,
  };
}

describe("a shrunk value passes the check the generator honoured", () => {
  const cases: [string, GenDescData, (number | string)[]][] = [
    ["email", { t: "Text" }, []],
    ["url", { t: "Text" }, []],
    ["uuid", { t: "Text" }, []],
    ["one-of", { t: "Text" }, ["sm", "md", "lg"]],
    ["one-of", { t: "Int" }, [3, 5, 9]],
    ["positive", { t: "Int" }, []],
    ["positive", { t: "Float" }, []],
    ["negative", { t: "Int" }, []],
    ["negative", { t: "Float" }, []],
    ["between", { t: "Int" }, [5, 11]],
    ["between", { t: "Float" }, [-9, -2]],
    ["nonempty", { t: "Text" }, []],
    ["len-gt", { t: "Text" }, [3]],
    ["len-eq", { t: "Text" }, [4]],
    ["len-lt", { t: "Text" }, [6]],
  ];
  for (const [pred, base, args] of cases) {
    const written = args.length > 0 ? `${pred}(${args.join(", ")})` : pred;
    it(`shrinks a ${String(base.t)} where ${written} only through values it accepts`, () => {
      const accepts = predicate(pred, args);
      const { refused, settled } = shrinkPath(descriptor(base, pred, args), accepts);
      expect(refused).toEqual([]);
      expect(accepts(settled)).toBe(true);
    });
  }

  // A form shrinks by trying texts one character shorter and keeping those
  // still in the shape it was generated in, so its path above has to have
  // reached some for the check on it to mean anything.
  for (const pred of ["email", "url"]) {
    it(`shrinks a Text where ${pred} through shorter values it accepts`, () => {
      const { tried, settled } = shrinkPath(descriptor({ t: "Text" }, pred), predicate(pred));
      expect((settled as string).length).toBeLessThan((tried[0] as string).length);
    });
  }
});
