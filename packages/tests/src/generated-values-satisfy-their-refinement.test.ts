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
