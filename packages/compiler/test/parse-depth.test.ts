import { compile, lex, ParseError, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

/** The parser's nesting limit. */
const MAX_DEPTH = 256;

const nest = (open: string, close: string, inner: string, depth: number) =>
  open.repeat(depth) + inner + close.repeat(depth);

/** `n` steps split between an inner chain (the first) and the outer one around it. */
const halves = (n: number): [number, number] => [Math.floor(n / 2), n - Math.floor(n / 2)];

/** A `+` chain of `steps` steps. */
const plusChain = (steps: number) => Array.from({ length: steps + 1 }, () => "1").join(" + ");

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
  {
    // The parenthesised operand sits two levels down: the `+`'s right operand, then the parentheses.
    name: "binary chain in a parenthesised operand of another",
    effective: 254,
    at: (d) => {
      const [inner, outer] = halves(d);
      return `slot v : Int = 1 + (${plusChain(inner)})${" + 1".repeat(outer - 1)}\n${TAIL}`;
    },
  },
  {
    name: "index chain on a nested list literal",
    effective: 255,
    at: (d) => {
      const [lists, steps] = halves(d);
      return `slot v : Int = ${nest("[", "]", "1", lists)}${"[0]".repeat(steps)}\n${TAIL}`;
    },
  },
  {
    // The parentheses and the arm's pattern each take a level.
    name: "binary chain on a match with a nested tuple pattern",
    effective: 253,
    at: (d) => {
      const [tuples, steps] = halves(d);
      return `slot q : Int = 0
slot v : Int = (match q with | ${nest("(x, ", ")", "y", tuples)} -> 1)${" + 1".repeat(steps)}
${TAIL}`;
    },
  },
  {
    // The index sits under the outer step's node, a level that step already counts.
    name: "index chain in the index of another",
    effective: 255,
    at: (d) => {
      const [inner, outer] = halves(d);
      return `slot xs : List(Int) = [1]
slot v : Int = xs[xs${"[0]".repeat(inner)}]${"[0]".repeat(outer - 1)}
${TAIL}`;
    },
  },
  {
    name: "assignment path whose first index is an index chain",
    effective: 255,
    at: (d) => {
      const [inner, outer] = halves(d);
      return `slot s : List(Int) = [1]
tile B = button(text="b", onClick=r)
reducer r on=ui.click(B) do= s[s${"[0]".repeat(inner)}]${"[0]".repeat(outer - 1)} := 1
tile App = column(B)
app M caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;
    },
  },
  {
    name: "prefix run in a parenthesised operand of another",
    effective: 254,
    at: (d) => {
      const [inner, outer] = halves(d);
      return `slot v : Int = ${"-".repeat(outer)}(${"-".repeat(inner)}1)\n${TAIL}`;
    },
  },
  {
    name: "where chain on a nested type application",
    effective: 256,
    at: (d) => {
      const [apps, wheres] = halves(d);
      return `type Id(T) = T
type T = ${nest("Id(", ")", "Text", apps)}${" where nonempty".repeat(wheres)}
slot v : T = "a"
${TAIL}`;
    },
  },
  {
    // Each run's first `where` is folded onto the type it follows.
    name: "where chain on a type application whose argument has one",
    effective: 256,
    at: (d) => {
      const [inner, outer] = halves(d);
      const where = " where nonempty";
      return `type Id(T) = T
type T = Id(Text${where.repeat(inner)})${where.repeat(outer)}
slot v : T = "a"
${TAIL}`;
    },
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

const WHERE = " where nonempty";

/** `Id(Id(…Id(Text) where…) where…) where…`, one entry of `wheres` per level, innermost first. */
const idNest = (wheres: readonly number[]): string =>
  wheres.reduce((inner, n) => `Id(${inner})${WHERE.repeat(n)}`, "Text");

const idProgram = (wheres: readonly number[]): string =>
  `type Id(T) = T\ntype T = ${idNest(wheres)}\nslot s : T = "a"\n${TAIL}`;

/** `t + (t + (…) + t …) + t …`: `levels` chains of `terms` terms, each the second term of the one around it. */
const plusNest = (levels: number, terms: number, t: string): string => {
  let e = t;
  for (let i = 0; i < levels; i++) e = `${t} + (${e})${` + ${t}`.repeat(terms - 2)}`;
  return e;
};

/** `xs[xs[…][0]…][0]…`: `levels` index chains of `steps` steps, each the first index of the one around it. */
const indexNest = (levels: number, steps: number): string => {
  let e = "0";
  for (let i = 0; i < levels; i++) e = `xs[${e}]${"[0]".repeat(steps - 1)}`;
  return e;
};

const REDUCER = "reducer r on=ui.click(App) do= ";

/** The 1-based column of the character right after `prefix`. */
const after = (prefix: string): number => prefix.length + 1;

const NESTED: readonly { name: string; source: string; line: number; col: number }[] = [
  // The innermost run reaches level L + 200; the run around it puts the tree at L + 199 + n.
  ...[10, 20].map((levels) => ({
    name: `a type of ${levels} \`Id(…)\` levels with 200 \`where\`s each`,
    source: idProgram(Array.from({ length: levels }, () => 200)),
    line: 2,
    col: after(
      `type T = ${"Id(".repeat(levels)}Text)${WHERE.repeat(200)})${WHERE.repeat(57 - levels - 1)} `,
    ),
  })),
  // Read at level 2, two levels per nesting: the second chain from the inside goes over at step 41.
  {
    name: "an assignment of 8 nested 200-term `+` chains",
    source: `slot x : Int = 0\n${REDUCER}x := ${plusNest(8, 200, "1")}\n${TAIL}`,
    line: 2,
    col: after(`${REDUCER}x := ${"1 + (".repeat(7)}${plusNest(1, 200, "1")})${" + 1".repeat(39)} `),
  },
  // A tile's text is read at level 3, one deeper than a reducer's right-hand side.
  {
    name: "a tile's text of 8 nested 200-term `+` chains",
    source: `tile Label = text(${plusNest(8, 200, '"a"')})\n${TAIL}`,
    line: 1,
    col: after(
      `tile Label = text(${'"a" + ('.repeat(7)}${plusNest(1, 200, '"a"')})${' + "a"'.repeat(38)} `,
    ),
  },
  // Each index is one level under the step it is read in: the chain around the innermost goes over at step 40.
  {
    name: "an assignment of 16 nested 200-step index chains",
    source: `slot xs : List(Int) = [1]\nslot y : Int = 0\n${REDUCER}y := ${indexNest(16, 200)}\n${TAIL}`,
    line: 3,
    col: after(`${REDUCER}y := ${"xs[".repeat(15)}${indexNest(1, 200)}]${"[0]".repeat(38)}`),
  },
];

describe("chains nested in one another spend one budget", () => {
  for (const c of NESTED) {
    it(`refuses ${c.name} at the step that goes over`, () => {
      const result = pipeline(c.source);
      expect(result, `${c.name} was not refused`).toBeInstanceOf(ParseError);
      const e = result as ParseError;
      expect(e.message).toContain(`Nesting is deeper than ${MAX_DEPTH} levels`);
      expect(e.pos).toMatchObject({ line: c.line, col: c.col });
    });
  }

  // 1 + Σ wheres = 255 levels: each application adds one, and each `where` but a run's first.
  const UNDER = [...Array.from({ length: 9 }, () => 25), 29];

  it("compiles a 10-level `Id(…)` type that is 255 levels deep", () => {
    expect(pipeline(idProgram(UNDER))).toBe("ok");
  });

  it("refuses it with one more `where`, at that `where`", () => {
    const over = [...UNDER.slice(0, -1), 30];
    const result = pipeline(idProgram(over));
    expect(result).toBeInstanceOf(ParseError);
    expect((result as ParseError).pos).toMatchObject({
      line: 2,
      col: after(`type T = Id(${idNest(over.slice(0, -1))})${WHERE.repeat(29)} `),
    });
  });
});
