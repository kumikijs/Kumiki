// Nesting deeper than the parser's recursion can carry used to surface as a
// bare `RangeError: Maximum call stack size exceeded` — no position, no
// message, nothing pointing at the source. Every construct that nests is
// bounded now, and the bound is a positioned `ParseError`.
//
// The thresholds differ per construct (parentheses ran out of stack at 781,
// tile calls at 2500), so a bound placed on only some of the entry points
// still leaves a `RangeError` reachable through the others. One row per
// construct is what makes a missed entry point visible.

import { lex, ParseError, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

/** The bound recorded in language.md §1.2.3. */
const MAX_DEPTH = 256;

const nest = (open: string, close: string, inner: string, depth: number) =>
  open.repeat(depth) + inner + close.repeat(depth);

/** Every self-recursive entry point in the parser, one source shape each. */
const FORMS: readonly { name: string; at: (depth: number) => string }[] = [
  {
    name: "parenthesised expression",
    at: (d) => `slot v : Int = ${nest("(", ")", "1", d)}\n`,
  },
  {
    name: "list literal",
    at: (d) => `slot v : Int = ${nest("[", "]", "1", d)}\n`,
  },
  {
    name: "record literal",
    at: (d) => `slot v : Int = ${nest("{a: ", "}", "1", d)}\n`,
  },
  {
    name: "if / else chain",
    at: (d) => `slot v : Int = ${"if true then 1 else ".repeat(d)}1\n`,
  },
  {
    name: "tile call",
    at: (d) => `tile T = ${nest("column(", ")", 'text("x")', d)}\n`,
  },
  {
    // A tuple is the only pattern that contains a pattern — a variant's
    // payloads are binds, so `Some(Some(y))` is not grammar at any depth.
    name: "tuple pattern",
    at: (d) => `slot v : Int = match q with | ${nest("(x, ", ")", "y", d)} -> 1\n`,
  },
  {
    name: "type application",
    at: (d) => `slot v : ${nest("List(", ")", "Int", d)} = []\n`,
  },
  {
    name: "theme record",
    at: (d) => `theme T = ${nest("{a: ", "}", "1", d)}\n`,
  },
];

describe("the parser bounds how deeply a program may nest", () => {
  for (const form of FORMS) {
    it(`reports a positioned error instead of overflowing on a deep ${form.name}`, () => {
      let thrown: unknown;
      try {
        parse(lex(form.at(2000)));
      } catch (e) {
        thrown = e;
      }
      expect(thrown, `a deep ${form.name} parsed without complaint`).toBeInstanceOf(ParseError);
      const pos = (thrown as ParseError).pos;
      expect(pos.line).toBeGreaterThanOrEqual(1);
      expect(pos.col).toBeGreaterThanOrEqual(1);
    });

    it(`accepts a ${form.name} well inside the bound`, () => {
      expect(() => parse(lex(form.at(100)))).not.toThrow();
    });
  }

  it("names the bound so the message says what to change", () => {
    let thrown: unknown;
    try {
      parse(lex(FORMS[0]?.at(2000) ?? ""));
    } catch (e) {
      thrown = e;
    }
    expect((thrown as ParseError).message).toContain(String(MAX_DEPTH));
  });
});

describe("a chain of prefix operators is not nesting", () => {
  // `not not not x` recursed once per operator, which is why a chain of them
  // could exhaust the stack. Collected iteratively there is no depth to bound,
  // so a chain far longer than the nesting limit is still a legal program.
  //
  // The length is what makes this a test rather than a statement: recursing
  // per operator runs out of stack between 5,000 and 10,000, so a chain
  // shorter than that passes either way.
  const CHAIN = 50_000;
  for (const op of ["not ", "-"]) {
    it(`parses a chain of ${JSON.stringify(op.trim())} far past the nesting bound`, () => {
      const src = `slot v : Int = ${op.repeat(CHAIN)}1\n`;
      expect(() => parse(lex(src))).not.toThrow();
    });
  }
});
