import { ParseError } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { checkSource } from "./helpers/diagnostics.ts";

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

const PLUS_CHAIN = `slot s : Int = ${Array.from({ length: 300 }, () => "1").join(" + ")}\n${TAIL}`;

/** A `RangeError` from the checker propagates and fails the test by itself. */
function parseErrorOf(source: string): ParseError | undefined {
  try {
    checkSource(source);
  } catch (e) {
    if (e instanceof ParseError) return e;
    throw e;
  }
  return undefined;
}

const reason = (e: ParseError | undefined): string | undefined =>
  e?.message.replace(/^Parse error at \d+:\d+: /, "");

describe("a chain past the 256-level budget is a positioned parse error", () => {
  it.each([
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
  ])("$name is refused as a + chain is, at the step that went over", ({ source, line, col }) => {
    const reference = parseErrorOf(PLUS_CHAIN);
    expect(reference, "the + chain no longer reports the bound").toBeInstanceOf(ParseError);
    const e = parseErrorOf(source);
    expect(e, "the chain reached the checker").toBeInstanceOf(ParseError);
    expect(reason(e)).toBe(reason(reference));
    expect(e?.pos).toMatchObject({ line, col });
  });
});
