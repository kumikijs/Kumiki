// `docs/spec/language.md` §1.2.3 bounds every tree at 256 levels, and the
// bound is on the tree the parse builds, not on how the parser built it: every
// stage after the parse walks the tree by recursion, so a chain read by a loop
// still exhausts the stack downstream.
//
// Two such loops build one node per step: the `where`s on a type, one
// `TypeRefinement` each, and an assignment target's path, one `LField` /
// `LIndex` per step. Each is charged to the budget like a `+` chain, so past
// it the parser refuses the program at the step that went over, rather than
// leaving the checker's recursive walk to fail with a bare `RangeError`.
//
// These are the reported programs, in the shape they were reported, through
// the two steps `kumiki check` runs, and each gives the positioned error a
// 300-term `+` chain gives. Each construct's exact threshold is pinned in
// `packages/compiler/test/parse-depth.test.ts`; that chains well inside the
// budget still check, build and run is `175-chains-within-the-depth-budget`.

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
  `type T = Int ${Array.from({ length: n }, () => "where between(0, 10)").join(" ")}
slot s : T = 1
${TAIL}`;

/** The chain that already reported: the error every case has to match. */
const PLUS300 = `slot s : Int = ${Array.from({ length: 300 }, () => "1").join(" + ")}\n${TAIL}`;

/**
 * Each program, the line its chain is on, and the token every step of that
 * chain starts with — the error has to point at one of them.
 */
const REPORTED: readonly { name: string; source: string; line: number; step: string }[] = [
  { name: "where300", source: where(300), line: 1, step: "where" },
  { name: "where3000", source: where(3000), line: 1, step: "where" },
  {
    name: "lv10000",
    source: `slot s : List(Int) = [1]
reducer r on=ui.click(App) do= s${"[0]".repeat(10_000)} := 1
${TAIL}`,
    line: 2,
    step: "[",
  },
  {
    name: "lvf10000",
    source: `type R = {a: Int}
slot s : R = {a: 1}
reducer r on=ui.click(App) do= s${".a".repeat(10_000)} := 1
${TAIL}`,
    line: 3,
    step: ".",
  },
];

/** What `kumiki check` does with a source: parse it, then check the program. */
function checkVerb(source: string): KumikiError[] | ParseError {
  let program: ReturnType<typeof parse>;
  try {
    program = parse(lex(source));
  } catch (e) {
    if (e instanceof ParseError) return e;
    throw e;
  }
  return check(program);
}

/** The message without its `Parse error at L:C:` prefix, which differs per case. */
const reason = (e: ParseError): string => e.message.replace(/^Parse error at \d+:\d+: /, "");

/** The source text from `e`'s position on. */
const from = (source: string, e: ParseError): string =>
  (source.split("\n")[e.pos.line - 1] ?? "").slice(e.pos.col - 1);

describe("a chain past the 256-level budget is a positioned parse error", () => {
  for (const c of REPORTED) {
    it(`${c.name} is refused as a + chain is, at a step of its own chain`, () => {
      const reference = checkVerb(PLUS300);
      expect(reference, "the + chain no longer reports the bound").toBeInstanceOf(ParseError);
      // A `RangeError` from the checker propagates out of `checkVerb` and fails
      // the test by itself; a list of diagnostics fails the line below.
      const result = checkVerb(c.source);
      expect(result, `${c.name} reached the checker`).toBeInstanceOf(ParseError);
      const e = result as ParseError;
      expect(reason(e)).toBe(reason(reference as ParseError));
      expect(e.pos.line).toBe(c.line);
      expect(from(c.source, e).slice(0, c.step.length)).toBe(c.step);
    });
  }
});
