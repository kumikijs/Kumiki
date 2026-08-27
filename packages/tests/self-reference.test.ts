// What the rejected forms did before they were rejected — through `compile`,
// which is the seam the CLI's `build` and the Vite plugin both go through.
//
// A unit test over `check` proves a diagnostic is produced. It does not prove
// the pipeline stops there, and for two of these three that is the whole point:
// a tile cycle crashed code generation with a `RangeError` and a derived slot
// produced an artifact that threw on mount. Each case below asserts both — the
// diagnostic, and that nothing is emitted to run.

import { type CompileResult, compile } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

const TAIL = `app Main caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;

/** `compile` never throws for these: the failure is a diagnostic, not a crash. */
function outcome(source: string): CompileResult {
  return compile(source, { runtimeSpecifier: "@kumikijs/runtime", capabilities: [] });
}

const REJECTED: readonly { what: string; code: string; source: string }[] = [
  {
    what: "a tile that expands into itself",
    code: "E0005",
    source: `tile App = column(text("a"), App)\n${TAIL}`,
  },
  {
    what: "two tiles that expand into each other",
    code: "E0005",
    source: `tile A = column(text("a"), B)
tile B = column(text("b"), A)
tile App = column(A)
${TAIL}`,
  },
  {
    what: "a fn that calls itself",
    code: "E0006",
    source: `fn fact(n: Int) -> Int = if n <= 1 then 1 else n * fact(n - 1)
tile App = column(text(fact(5).show))
${TAIL}`,
  },
  {
    what: "a slot initializer that reads another slot",
    code: "E0304",
    source: `slot b : Int = 1
slot a : Int = b + 1
tile App = column(text(a.show))
${TAIL}`,
  },
];

describe("a definition written in terms of itself never reaches code generation", () => {
  for (const { what, code, source } of REJECTED) {
    it(`refuses to build ${what}`, () => {
      const result = outcome(source);
      expect(result.kind, `${what} produced an artifact`).toBe("fail");
      if (result.kind !== "fail") return;
      expect(result.errors.map((e) => e.code)).toContain(code);
      // A diagnostic with no position is one a caller cannot act on, and
      // "somewhere in this program" is what the crash already said.
      for (const e of result.errors) {
        expect(e.pos.line).toBeGreaterThanOrEqual(1);
        expect(e.pos.col).toBeGreaterThanOrEqual(1);
      }
    });
  }

  it("builds the accepted forms of all three", () => {
    // The same three shapes written the way the language provides for:
    // repetition through `for`, derivation through `fn`, and a slot that
    // stands on its own.
    const source = `slot xs : List(Int) = [1, 2, 3]
fn total(ns: List(Int)) -> Int = ns.fold(0, $1 + $2)
tile Item in=Int = text($1.show)
tile App = column(for x in xs Item(x) {key: x.show}, text(total(xs).show))
${TAIL}`;
    expect(outcome(source).kind).toBe("ok");
  });
});
