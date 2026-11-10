import { compile, lex, ParseError, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { withApp, withReducer } from "./helpers/programs.ts";

/** The parser's nesting limit. */
const MAX_DEPTH = 256;

const nest = (open: string, close: string, inner: string, depth: number) =>
  open.repeat(depth) + inner + close.repeat(depth);

/** `n` steps split between an inner chain (the first) and the outer one around it. */
const halves = (n: number): [number, number] => [Math.floor(n / 2), n - Math.floor(n / 2)];

/** A chain of `steps` `op` steps over `term`: `chain("+", "1", 2)` is `1 + 1 + 1`. */
const chain = (op: string, term: string, steps: number) =>
  Array.from({ length: steps + 1 }, () => term).join(` ${op} `);

/** A `+` chain of `steps` steps. */
const plusChain = (steps: number) => chain("+", "1", steps);

/** `defs`, then an `App` and the app around it. */
const program = (defs: string) => withApp(`${defs}\ntile App = column(text("x"))`);

/** A program whose slot `v` is `value`, after `defs`. */
const slot = (type: string, value: string, defs = "") =>
  program(`${defs}slot v : ${type} = ${value}`);

/** How the line `withReducer` writes its body on begins. */
const DO = "reducer r on=ui.click(B) do= ";

const WHERE = " where nonempty";
const BETWEEN = " where between(0, 10)";

/** The 1-based column of the character right after `prefix`. */
const after = (prefix: string): number => prefix.length + 1;

const FORMS: readonly { name: string; effective: number; at: (depth: number) => string }[] = [
  {
    // Parentheses build no node, so only how deep the parser recurses bounds them.
    name: "a parenthesised expression",
    effective: 256,
    at: (d) => slot("Int", nest("(", ")", "1", d)),
  },
  {
    // A tuple is a node, though its first item is read inside its parentheses.
    name: "a tuple whose first item is a tuple",
    effective: 255,
    at: (d) => slot("Int", `${"(".repeat(d)}1${", 1)".repeat(d)}`),
  },
  { name: "a list literal", effective: 255, at: (d) => slot("Int", nest("[", "]", "1", d)) },
  {
    name: "a record literal",
    effective: 255,
    at: (d) => slot("Int", nest("{a: ", "}", "1", d)),
  },
  {
    name: "an if / else chain",
    effective: 255,
    at: (d) => slot("Int", `${"if true then 1 else ".repeat(d)}1`),
  },
  {
    name: "a tile call",
    effective: 253,
    at: (d) => program(`tile T = ${nest("column(", ")", 'text("x")', d)}`),
  },
  {
    name: "a tuple pattern",
    effective: 255,
    at: (d) =>
      slot("Int", `match q with | ${nest("(x, ", ")", "y", d)} -> 1`, "slot q : Int = 0\n"),
  },
  {
    name: "a type application",
    effective: 256,
    at: (d) => program(`slot v : ${nest("List(", ")", "Int", d)} = []`),
  },
  {
    name: "a theme record",
    effective: 257,
    at: (d) => program(`theme T = ${nest("{a: ", "}", "1", d)}`),
  },
  {
    name: "an if statement",
    effective: 254,
    at: (d) =>
      withReducer("slot x : Int = 0", `${"if true then { ".repeat(d)}x := 1${" }".repeat(d)}`),
  },
  {
    name: "a for statement",
    effective: 254,
    at: (d) =>
      withReducer("slot x : Int = 0", `${"for i in [1] { ".repeat(d)}x := 1${" }".repeat(d)}`),
  },
  { name: "a binary operator chain", effective: 255, at: (d) => slot("Int", plusChain(d)) },
  {
    name: "a method chain",
    effective: 255,
    at: (d) => slot("Text", `""${".trim()".repeat(d)}`),
  },
  {
    name: "a prefix operator run",
    effective: 255,
    at: (d) => slot("Int", `${"-".repeat(d)}1`),
  },
  {
    name: "a where chain",
    effective: 255,
    at: (d) => program(`type T = Int${BETWEEN.repeat(d)}\nslot v : T = 1`),
  },
  {
    name: "a slot-assignment index path",
    effective: 255,
    at: (d) => withReducer("slot s : List(Int) = [1]", `s${"[0]".repeat(d)} := 1`),
  },
  {
    name: "a slot-assignment field path",
    effective: 255,
    at: (d) => withReducer("type R = {a: Int}\nslot s : R = {a: 1}", `s${".a".repeat(d)} := 1`),
  },
  {
    name: "a slot-assignment mixed path",
    effective: 255,
    at: (d) =>
      withReducer(
        "type R = {a: List(R)}\nslot s : R = {a: []}",
        `s${Array.from({ length: d }, (_, i) => (i % 2 === 0 ? ".a" : "[0]")).join("")} := ${d % 2 === 1 ? "[]" : "{a: []}"}`,
      ),
  },
  {
    name: "a where chain on a record field",
    effective: 254,
    at: (d) => program(`type T = {f: Int${BETWEEN.repeat(d)}}\nslot v : T = {f: 1}`),
  },
  {
    name: "a slot-assignment path inside an if",
    effective: 254,
    at: (d) => withReducer("slot s : List(Int) = [1]", `if true then { s${"[0]".repeat(d)} := 1 }`),
  },
  {
    // The parenthesised operand is the `+`'s right operand, a level under it.
    name: "a binary chain in a parenthesised operand of another",
    effective: 255,
    at: (d) => {
      const [inner, outer] = halves(d);
      return slot("Int", `1 + (${plusChain(inner)})${" + 1".repeat(outer - 1)}`);
    },
  },
  {
    name: "an index chain on a nested list literal",
    effective: 255,
    at: (d) => {
      const [lists, steps] = halves(d);
      return slot("Int", `${nest("[", "]", "1", lists)}${"[0]".repeat(steps)}`);
    },
  },
  {
    // The arm's pattern sits a level under the `match`.
    name: "a binary chain on a match with a nested tuple pattern",
    effective: 254,
    at: (d) => {
      const [tuples, steps] = halves(d);
      const match = `(match q with | ${nest("(x, ", ")", "y", tuples)} -> 1)`;
      return slot("Int", `${match}${" + 1".repeat(steps)}`, "slot q : Int = 0\n");
    },
  },
  {
    // The index sits under the outer step's node, a level that step already counts.
    name: "an index chain in the index of another",
    effective: 255,
    at: (d) => {
      const [inner, outer] = halves(d);
      return slot(
        "Int",
        `xs[xs${"[0]".repeat(inner)}]${"[0]".repeat(outer - 1)}`,
        "slot xs : List(Int) = [1]\n",
      );
    },
  },
  {
    name: "an assignment path whose first index is an index chain",
    effective: 255,
    at: (d) => {
      const [inner, outer] = halves(d);
      return withReducer(
        "slot s : List(Int) = [1]",
        `s[s${"[0]".repeat(inner)}]${"[0]".repeat(outer - 1)} := 1`,
      );
    },
  },
  {
    name: "a prefix run in a parenthesised operand of another",
    effective: 255,
    at: (d) => {
      const [inner, outer] = halves(d);
      return slot("Int", `${"-".repeat(outer)}(${"-".repeat(inner)}1)`);
    },
  },
  {
    name: "a where chain on a nested type application",
    effective: 255,
    at: (d) => {
      const [apps, wheres] = halves(d);
      return program(
        `type Id(T) = T\ntype T = ${nest("Id(", ")", "Text", apps)}${WHERE.repeat(wheres)}\nslot v : T = "a"`,
      );
    },
  },
  {
    // A run's first `where` is a node over the type it follows, as each later one is.
    name: "a where chain on a type application whose argument has one",
    effective: 254,
    at: (d) => {
      const [inner, outer] = halves(d);
      return program(
        `type Id(T) = T\ntype T = Id(Text${WHERE.repeat(inner)})${WHERE.repeat(outer)}\nslot v : T = "a"`,
      );
    },
  },
  {
    name: "a where chain on a type application with a union argument after a deep one",
    effective: 254,
    at: (d) => {
      const [apps, wheres] = halves(d);
      return program(
        `type Id(T) = T\ntype P(A, B) = A\ntype T = P(${nest("Id(", ")", "Text", apps)}, A | B)${WHERE.repeat(wheres)}\nslot v : T = "a"`,
      );
    },
  },
  {
    name: "a sum whose right operand is a parenthesised sum",
    effective: 255,
    at: (d) => slot("Int", `${"1 + (".repeat(d)}1${")".repeat(d)}`),
  },
  {
    name: "a sum whose left operand is a parenthesised sum",
    effective: 255,
    at: (d) => slot("Int", `${"(".repeat(d)}1${" + 1)".repeat(d)}`),
  },
  {
    name: "a product inside a sum",
    effective: 255,
    at: (d) => {
      const [inner, outer] = halves(d);
      return slot("Int", `1 + ${chain("*", "1", inner)}${" + 1".repeat(outer - 1)}`);
    },
  },
  {
    name: "a prefix run inside a product",
    effective: 255,
    at: (d) => {
      const [inner, outer] = halves(d);
      return slot("Int", `1 * ${"-".repeat(inner)}1${" * 1".repeat(outer - 1)}`);
    },
  },
  {
    name: "a conjunction inside a disjunction",
    effective: 255,
    at: (d) => {
      const [inner, outer] = halves(d);
      return slot("Bool", `true || ${chain("&&", "true", inner)}${" || true".repeat(outer - 1)}`);
    },
  },
  {
    name: "a comparison chain inside a conjunction",
    effective: 255,
    at: (d) => {
      const [inner, outer] = halves(d);
      return slot("Bool", `true && ${chain("==", "1", inner)}${" && true".repeat(outer - 1)}`);
    },
  },
  {
    name: "a sum inside a comparison chain",
    effective: 255,
    at: (d) => {
      const [inner, outer] = halves(d);
      return slot("Bool", `1 == ${plusChain(inner)}${" == 1".repeat(outer - 1)}`);
    },
  },
  {
    name: "a method chain after an index chain in an index",
    effective: 255,
    at: (d) => {
      const [inner, outer] = halves(d);
      return slot(
        "Text",
        `xs[xs${"[0]".repeat(inner)}]${".trim()".repeat(outer - 1)}`,
        'slot xs : List(Text) = ["a"]\n',
      );
    },
  },
  {
    name: "an assignment field path after an index chain in an index",
    effective: 255,
    at: (d) => {
      const [inner, outer] = halves(d);
      return withReducer(
        "type R = {a: R}\nslot s : List(R) = []",
        `s[s${"[0]".repeat(inner)}]${".a".repeat(outer - 1)} := 1`,
      );
    },
  },
  // A right operand sits a level under its operator, so a nested list there has one level fewer
  // than a list literal alone.
  {
    name: "a nested list as a product's right operand",
    effective: 254,
    at: (d) => slot("Int", `1 * ${nest("[", "]", "1", d)}`),
  },
  {
    name: "a nested list as a disjunction's right operand",
    effective: 254,
    at: (d) => slot("Bool", `true || ${nest("[", "]", "true", d)}`),
  },
  {
    // A right operand is a level deeper but no parse deeper, so here the level reaches the budget
    // first.
    name: "a nested tuple pattern in a product's right operand",
    effective: 254,
    at: (d) =>
      slot("Int", `1 * match q with | ${nest("(x, ", ")", "y", d)} -> 1`, "slot q : Int = 0\n"),
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

describe.each(FORMS)("$name", ({ name, effective, at }) => {
  it("is refused at its limit, with a position", () => {
    const result = pipeline(at(effective));
    expect(result, `${name} was not refused`).toBeInstanceOf(ParseError);
    const { pos } = result as ParseError;
    expect(pos.line).toBeGreaterThanOrEqual(1);
    expect(pos.col).toBeGreaterThan(1);
  });

  it("is accepted one level under its limit", () => {
    expect(pipeline(at(effective - 1)), `${name} was refused`).not.toBeInstanceOf(ParseError);
  });

  it("is refused far past the limit without exhausting the stack", () => {
    expect(pipeline(at(20_000))).toBeInstanceOf(ParseError);
  });

  it("throws ParseError from the parser, not RangeError, far past the limit", () => {
    expect(() => parse(lex(at(20_000)))).toThrow(ParseError);
  });
});

it("names the bound so the message says what to change", () => {
  const result = pipeline(FORMS[0]?.at(20_000) ?? "");
  expect((result as ParseError).message).toContain(String(MAX_DEPTH));
});

/** `Id(Id(…Id(Text) where…) where…) where…`, one entry of `wheres` per level, innermost first. */
const idNest = (wheres: readonly number[]): string =>
  wheres.reduce((inner, n) => `Id(${inner})${WHERE.repeat(n)}`, "Text");

const idProgram = (wheres: readonly number[]): string =>
  program(`type Id(T) = T\ntype T = ${idNest(wheres)}\nslot s : T = "a"`);

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

const AT_STEP: readonly { name: string; source: string; line: number; col: number }[] = [
  // The run is charged at its operand, the first token after it.
  {
    name: "a prefix operator run at its limit",
    source: slot("Int", `${"-".repeat(255)}1`),
    line: 1,
    col: after(`slot v : Int = ${"-".repeat(255)}`),
  },
  {
    name: "a where chain at its limit",
    source: program(`type T = Int${BETWEEN.repeat(255)}\nslot v : T = 1`),
    line: 1,
    col: after(`type T = Int${BETWEEN.repeat(254)} `),
  },
  // The product is the first step's right operand, so every later step sits over it.
  {
    name: "a product inside a sum at its limit",
    source: slot("Int", `1 + ${chain("*", "1", 127)}${" + 1".repeat(127)}`),
    line: 1,
    col: after(`slot v : Int = 1 + ${chain("*", "1", 127)}${" + 1".repeat(126)} `),
  },
  {
    name: "a where chain on a type application with a union argument at its limit",
    source: program(
      `type Id(T) = T\ntype P(A, B) = A\ntype T = P(${nest("Id(", ")", "Text", 127)}, A | B)${WHERE.repeat(127)}\nslot v : T = "a"`,
    ),
    line: 3,
    col: after(`type T = P(${nest("Id(", ")", "Text", 127)}, A | B)${WHERE.repeat(126)} `),
  },
  // The innermost run reaches level L + 201; the run around it puts the tree at L + 201 + n.
  ...[10, 20].map((levels) => ({
    name: `a type of ${levels} \`Id(…)\` levels with 200 \`where\`s each`,
    source: idProgram(Array.from({ length: levels }, () => 200)),
    line: 2,
    col: after(
      `type T = ${"Id(".repeat(levels)}Text)${WHERE.repeat(200)})${WHERE.repeat(55 - levels - 1)} `,
    ),
  })),
  // Read at level 2, a level deeper per nesting: the second chain from the inside goes over at
  // step 49.
  {
    name: "an assignment of 8 nested 200-term `+` chains",
    source: withReducer("slot x : Int = 0", `x := ${plusNest(8, 200, "1")}`),
    line: 2,
    col: after(`${DO}x := ${"1 + (".repeat(7)}${plusNest(1, 200, "1")})${" + 1".repeat(47)} `),
  },
  // A tile's text is read at level 3, one deeper than a reducer's right-hand side.
  {
    name: "a tile's text of 8 nested 200-term `+` chains",
    source: program(`tile Label = text(${plusNest(8, 200, '"a"')})`),
    line: 1,
    col: after(
      `tile Label = text(${'"a" + ('.repeat(7)}${plusNest(1, 200, '"a"')})${' + "a"'.repeat(46)} `,
    ),
  },
  // Each index is one level under the step it is read in: the chain around the innermost goes over at step 40.
  {
    name: "an assignment of 16 nested 200-step index chains",
    source: withReducer(
      "slot xs : List(Int) = [1]\nslot y : Int = 0",
      `y := ${indexNest(16, 200)}`,
    ),
    line: 3,
    col: after(`${DO}y := ${"xs[".repeat(15)}${indexNest(1, 200)}]${"[0]".repeat(38)}`),
  },
];

describe("the parser refuses at the step that goes over", () => {
  it.each(AT_STEP)("$name", ({ source, line, col }) => {
    const result = pipeline(source);
    expect(result).toBeInstanceOf(ParseError);
    const e = result as ParseError;
    expect(e.message).toContain(`Nesting is deeper than ${MAX_DEPTH} levels`);
    expect(e.pos).toMatchObject({ line, col });
  });
});

describe("a 10-level `Id(…)` type spends one budget", () => {
  // 1 + 10 + Σ wheres = 255 levels: the type, each application, and each `where`.
  const UNDER = [...Array.from({ length: 9 }, () => 24), 28];
  const OVER = [...UNDER.slice(0, -1), 29];

  it("compiles one `where` inside the budget", () => {
    expect(pipeline(idProgram(UNDER))).toBe("ok");
  });

  it("refuses one more `where`, at that `where`", () => {
    const result = pipeline(idProgram(OVER));
    expect(result).toBeInstanceOf(ParseError);
    expect((result as ParseError).pos).toMatchObject({
      line: 2,
      col: after(`type T = Id(${idNest(OVER.slice(0, -1))})${WHERE.repeat(28)} `),
    });
  });
});
