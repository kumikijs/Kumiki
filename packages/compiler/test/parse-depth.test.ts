// A tree deeper than the call stack can walk used to surface as a bare
// `RangeError: Maximum call stack size exceeded` — no position, no message,
// nothing pointing at the source. The bound is a positioned `ParseError` now.
//
// The bound is on the tree, not on how the parser reached it. That distinction
// is the whole subject here: a left-associative chain (`1 + 1 + 1 + …`,
// `x.trim().trim()…`, a run of `not`) is parsed by a loop and costs the parser
// no stack, but still builds one node per operator — so bounding only what the
// parser recursed through moved the crash downstream instead of removing it,
// and `compile` went down at ~2,500 operators while `parse` returned clean.
//
// Every assertion therefore goes through `compile`, not `parse`. The thresholds
// also differ per construct, so one row per construct is what makes a missed
// entry point visible.

import { compile, lex, ParseError, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

/** The bound recorded in language.md §1.2.3. */
const MAX_DEPTH = 256;

const nest = (open: string, close: string, inner: string, depth: number) =>
  open.repeat(depth) + inner + close.repeat(depth);

const TAIL = `tile App = column(text("x"))
app M caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;

/**
 * Every construct that can contain itself, and every chain that builds one
 * node per operator without recursing.
 *
 * `effective` is where each first refuses. They are not all `MAX_DEPTH`: a
 * construct whose parse passes through more than one guarded entry point —
 * a tile call goes through `parseTileExpr` and `parseTileCall` — spends the
 * extra level on the way in, and the budget is over the resulting tree.
 */
const FORMS: readonly { name: string; effective: number; at: (depth: number) => string }[] = [
  {
    name: "parenthesised expression",
    effective: 255,
    at: (d) => `slot v : Int = ${nest("(", ")", "1", d)}\n${TAIL}`,
  },
  {
    name: "list literal",
    effective: 255,
    at: (d) => `slot v : Int = ${nest("[", "]", "1", d)}\n${TAIL}`,
  },
  {
    name: "record literal",
    effective: 255,
    at: (d) => `slot v : Int = ${nest("{a: ", "}", "1", d)}\n${TAIL}`,
  },
  {
    name: "if / else chain",
    effective: 255,
    at: (d) => `slot v : Int = ${"if true then 1 else ".repeat(d)}1\n${TAIL}`,
  },
  {
    name: "tile call",
    effective: 253,
    at: (d) => `tile T = ${nest("column(", ")", 'text("x")', d)}\n${TAIL}`,
  },
  {
    // A tuple is the only pattern that contains a pattern — a variant's
    // payloads are binds, so `Some(Some(y))` is not grammar at any depth.
    name: "tuple pattern",
    effective: 255,
    at: (d) =>
      `slot q : Int = 0\nslot v : Int = match q with | ${nest("(x, ", ")", "y", d)} -> 1\n${TAIL}`,
  },
  {
    name: "type application",
    effective: 256,
    at: (d) => `slot v : ${nest("List(", ")", "Int", d)} = []\n${TAIL}`,
  },
  {
    name: "theme record",
    effective: 257,
    at: (d) => `theme T = ${nest("{a: ", "}", "1", d)}\n${TAIL}`,
  },
  {
    // Statement bodies nest through `parseStatement` → `parseStatementBody` →
    // `parseStatement`, a path distinct from the expression-level `if`.
    name: "if statement",
    effective: 254,
    at: (d) =>
      `slot x : Int = 0
tile B = button(text="b", onClick=r)
reducer r on=ui.click(B) do= ${"if true then { ".repeat(d)}x := 1${" }".repeat(d)}
tile App = column(B)
app M caps=[] routes={"/" -> App, "/404" -> App} init=[]
`,
  },
  {
    name: "for statement",
    effective: 254,
    at: (d) =>
      `slot x : Int = 0
tile B = button(text="b", onClick=r)
reducer r on=ui.click(B) do= ${"for i in [1] { ".repeat(d)}x := 1${" }".repeat(d)}
tile App = column(B)
app M caps=[] routes={"/" -> App, "/404" -> App} init=[]
`,
  },
  // The chains. Each is parsed by a loop, so none of these cost the parser any
  // stack — and each still builds one node per operator.
  {
    name: "binary operator chain",
    effective: 255,
    at: (d) => `slot v : Int = ${Array.from({ length: d + 1 }, () => "1").join(" + ")}\n${TAIL}`,
  },
  {
    name: "method chain",
    effective: 255,
    at: (d) => `slot v : Text = ""${".trim()".repeat(d)}\n${TAIL}`,
  },
  {
    name: "prefix operator run",
    effective: 255,
    at: (d) => `slot v : Int = ${"-".repeat(d)}1\n${TAIL}`,
  },
];

/** What the whole pipeline does with a source — never a `RangeError`. */
function pipeline(source: string): "ok" | "fail" | ParseError {
  try {
    return compile(source, { runtimeSpecifier: "@kumikijs/runtime", capabilities: [] }).kind;
  } catch (e) {
    if (e instanceof ParseError) return e;
    throw e;
  }
}

describe("the parser bounds how deep a tree a program may build", () => {
  for (const form of FORMS) {
    it(`refuses a ${form.name} at its limit, with a position`, () => {
      const result = pipeline(form.at(form.effective));
      expect(result, `a deep ${form.name} was not refused`).toBeInstanceOf(ParseError);
      const { pos } = result as ParseError;
      // A real token position — `1:1` is what a synthesised one looks like,
      // and every one of these is deep inside a long line.
      expect(pos.line).toBeGreaterThanOrEqual(1);
      expect(pos.col).toBeGreaterThan(1);
    });

    it(`accepts a ${form.name} one level under its limit`, () => {
      // Pinned exactly, so a limit that drifts — in either direction — fails
      // one of this pair rather than passing both.
      expect(
        pipeline(form.at(form.effective - 1)),
        `a legal ${form.name} was refused`,
      ).not.toBeInstanceOf(ParseError);
    });

    it(`refuses a ${form.name} far past the limit without exhausting the stack`, () => {
      expect(pipeline(form.at(20_000))).toBeInstanceOf(ParseError);
    });
  }

  it("names the bound so the message says what to change", () => {
    const result = pipeline(FORMS[0]?.at(20_000) ?? "");
    expect((result as ParseError).message).toContain(String(MAX_DEPTH));
  });
});

describe("a parse error is never a stack overflow", () => {
  it("throws ParseError, not RangeError, for every form far past the limit", () => {
    for (const form of FORMS) {
      let thrown: unknown;
      try {
        parse(lex(form.at(20_000)));
      } catch (e) {
        thrown = e;
      }
      expect(thrown, `${form.name} did not throw`).toBeInstanceOf(ParseError);
      expect(thrown, `${form.name} overflowed the stack`).not.toBeInstanceOf(RangeError);
    }
  });
});
