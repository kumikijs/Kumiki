// `docs/spec/language.md` §1.2.3 bounds every tree at 256 levels, and the
// bound is on the tree the parse builds, not on how the parser built it: every
// stage after the parse walks the tree by recursion, so a chain read by a loop
// still exhausts the stack downstream.
//
// Two of the loops that build one node per step are the `where`s on a type,
// one `TypeRefinement` each, and an assignment target's path, one `LField` /
// `LIndex` per step. Each is charged to the budget like a `+` chain, so a
// chain that is itself longer than the budget is refused at the step that
// went over instead of reaching the checker's recursive walk.
//
// Each case is one such chain far past the budget (300 and 3,000 `where`s, a
// 10,000-step index path and a 10,000-step field path), run through what
// `kumiki check` runs, and must give the positioned error a 300-term `+` chain
// gives. Each construct's exact threshold is pinned in
// `packages/compiler/test/parse-depth.test.ts`; `175-chains-within-the-depth-budget`
// shows that chains well inside the budget still check, build and run.

import { check, type KumikiError, lex, ParseError, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

const TAIL = `
tile App = column(text("x"))
app A
  caps = []
  routes = {"/" -> App, "/404" -> App}
  init = []
`;

const where = (n: number): string =>
  `type T = Int${" where between(0, 10)".repeat(n)}\nslot s : T = 1\n${TAIL}`;

/** Everything on an assignment's line ahead of its path's first step. */
const ASSIGN = "reducer r on=ui.click(App) do= s";

/** The column of step `n` of a chain that starts after `prefix`, `stride` characters a step. */
const stepCol = (prefix: string, stride: number, n: number): number =>
  prefix.length + 1 + stride * (n - 1);

/** A 300-term `+` chain, which already reports the bound: the error every case has to match. */
const PLUS_CHAIN = `slot s : Int = ${Array.from({ length: 300 }, () => "1").join(" + ")}\n${TAIL}`;

/** Each chain, and where the step that goes over the budget starts. */
const PAST_THE_BUDGET: readonly { name: string; source: string; line: number; col: number }[] = [
  {
    name: "a type with 300 `where`s",
    source: where(300),
    line: 1,
    col: stepCol("type T = Int ", 21, 256),
  },
  {
    name: "a type with 3,000 `where`s",
    source: where(3000),
    line: 1,
    col: stepCol("type T = Int ", 21, 256),
  },
  {
    name: "a 10,000-step `[0]` assignment path",
    source: `slot s : List(Int) = [1]\n${ASSIGN}${"[0]".repeat(10_000)} := 1\n${TAIL}`,
    line: 2,
    col: stepCol(ASSIGN, 3, 255),
  },
  {
    name: "a 10,000-step `.a` assignment path",
    source: `type R = {a: Int}\nslot s : R = {a: 1}\n${ASSIGN}${".a".repeat(10_000)} := 1\n${TAIL}`,
    line: 3,
    col: stepCol(ASSIGN, 2, 255),
  },
];

/** What `kumiki check` does with a source: parse it, then check the program. */
function checkVerb(source: string): KumikiError[] | ParseError {
  try {
    return check(parse(lex(source)));
  } catch (e) {
    if (e instanceof ParseError) return e;
    throw e;
  }
}

/** The message without its `Parse error at L:C:` prefix, which differs per case. */
const reason = (e: ParseError): string => e.message.replace(/^Parse error at \d+:\d+: /, "");

describe("a chain past the 256-level budget is a positioned parse error", () => {
  for (const c of PAST_THE_BUDGET) {
    it(`${c.name} is refused as a + chain is, at the step that went over`, () => {
      const reference = checkVerb(PLUS_CHAIN);
      expect(reference, "the + chain no longer reports the bound").toBeInstanceOf(ParseError);
      // A `RangeError` from the checker propagates out of `checkVerb` and fails
      // the test by itself; a list of diagnostics fails the line below.
      const result = checkVerb(c.source);
      expect(result, `${c.name} reached the checker`).toBeInstanceOf(ParseError);
      const e = result as ParseError;
      expect(reason(e)).toBe(reason(reference as ParseError));
      expect(e.pos).toMatchObject({ line: c.line, col: c.col });
    });
  }
});
