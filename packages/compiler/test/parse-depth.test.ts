import { compile, lex, ParseError, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

/** The parser's nesting limit. */
const MAX_DEPTH = 256;

const nest = (open: string, close: string, inner: string, depth: number) =>
  open.repeat(depth) + inner + close.repeat(depth);

const TAIL = `tile App = column(text("x"))
app M caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;

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
  {
    // The first `where` is read with the type's atom, before the chain starts charging.
    name: "where chain",
    effective: 256,
    at: (d) => `type T = Int${" where between(0, 10)".repeat(d)}\nslot v : T = 1\n${TAIL}`,
  },
  {
    name: "slot-assignment index path",
    effective: 255,
    at: (d) =>
      `slot s : List(Int) = [1]
tile B = button(text="b", onClick=r)
reducer r on=ui.click(B) do= s${"[0]".repeat(d)} := 1
tile App = column(B)
app M caps=[] routes={"/" -> App, "/404" -> App} init=[]
`,
  },
  {
    name: "slot-assignment field path",
    effective: 255,
    at: (d) =>
      `type R = {a: Int}
slot s : R = {a: 1}
tile B = button(text="b", onClick=r)
reducer r on=ui.click(B) do= s${".a".repeat(d)} := 1
tile App = column(B)
app M caps=[] routes={"/" -> App, "/404" -> App} init=[]
`,
  },
  {
    name: "slot-assignment mixed path",
    effective: 255,
    at: (d) =>
      `type R = {a: List(R)}
slot s : R = {a: []}
tile B = button(text="b", onClick=r)
reducer r on=ui.click(B) do= s${Array.from({ length: d }, (_, i) => (i % 2 === 0 ? ".a" : "[0]")).join("")} := ${d % 2 === 1 ? "[]" : "{a: []}"}
tile App = column(B)
app M caps=[] routes={"/" -> App, "/404" -> App} init=[]
`,
  },
  {
    name: "where chain on a record field",
    effective: 255,
    at: (d) =>
      `type T = {f: Int${" where between(0, 10)".repeat(d)}}\nslot v : T = {f: 1}\n${TAIL}`,
  },
  {
    name: "slot-assignment path inside an if",
    effective: 254,
    at: (d) =>
      `slot s : List(Int) = [1]
tile B = button(text="b", onClick=r)
reducer r on=ui.click(B) do= if true then { s${"[0]".repeat(d)} := 1 }
tile App = column(B)
app M caps=[] routes={"/" -> App, "/404" -> App} init=[]
`,
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
      expect(pos.line).toBeGreaterThanOrEqual(1);
      expect(pos.col).toBeGreaterThan(1);
    });

    it(`accepts a ${form.name} one level under its limit`, () => {
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
