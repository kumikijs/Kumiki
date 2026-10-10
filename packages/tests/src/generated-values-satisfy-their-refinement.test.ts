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
 * 200 generated values, each asserted against the predicate.
 * Run through the runner the language's own `property-test` uses rather than a loop of our own, so the seeding and the descriptor reading are the real ones.
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
  it.each(["email", "url", "uuid"])("generates a %s its own predicate accepts", (pred) => {
    const desc = descriptor({ t: "Text" }, pred);
    expect(desc).toMatchObject({ t: "Text", form: pred });
    expect(generatedValuesPass(desc, predicate(pred))).toBeUndefined();
  });

  // `positive` on a Float is the arm where a bound of 0 would hand the check the one value it refuses.
  it.each<[string, GenDescData, (number | string)[]]>([
    ["one-of", { t: "Text" }, ["sm", "md", "lg"]],
    ["one-of", { t: "Int" }, [1, 2, 3]],
    ["positive", { t: "Int" }, []],
    ["positive", { t: "Float" }, []],
    ["negative", { t: "Int" }, []],
    ["negative", { t: "Float" }, []],
    ["between", { t: "Int" }, [0, 11]],
    ["nonempty", { t: "Text" }, []],
    ["len-gt", { t: "Text" }, [3]],
  ])("generates a value the %s check over %o accepts", (pred, base, args) => {
    expect(
      generatedValuesPass(descriptor(base, pred, args), predicate(pred, args)),
    ).toBeUndefined();
  });
});

/**
 * Every value a never-holding property over `desc` hands its trial (the generated one, then each
 * shrink candidate), those the predicate refuses, and the counterexample shrinking settles on.
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
  it.each<[string, GenDescData, (number | string)[]]>([
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
  ])("shrinks through values the %s check over %o accepts", (pred, base, args) => {
    const accepts = predicate(pred, args);
    const { refused, settled } = shrinkPath(descriptor(base, pred, args), accepts);
    expect(refused).toEqual([]);
    expect(accepts(settled)).toBe(true);
  });

  // The check above means something for a form only if shrinking reached a shorter value.
  it.each(["email", "url"])("shrinks a Text where %s through shorter values it accepts", (pred) => {
    const { tried, settled } = shrinkPath(descriptor({ t: "Text" }, pred), predicate(pred));
    expect((settled as string).length).toBeLessThan((tried[0] as string).length);
  });
});
