import { codegen, type KumikiError, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { checkSource, codesOf, summariesOf, textAt } from "./helpers/diagnostics.ts";

const PRELUDE = `
type Tree     = Leaf | Node(Int, Tree)
type Chain    = {v: Int, next: Option(Chain)}
type Rose     = {v: Int, kids: List(Rose)}
type Box(T)   = {v: T}
type Seq(T)   = End | More(T, Seq(T))
type Inf      = {v: Int, next: Inf}
type Holder   = Empty | Holds(Inf)
type Grow(T)  = Stop | Deeper(Grow(List(T)))
type Expr     = Lit(Int) | Neg(Term)
type Term     = {e: Expr, note: Option(Term)}
type Pos      = Int where positive
type Annot(T) = {value: T, comments: List(Comment)}
type Comment  = {text: Text, replies: List(Annot(Comment))}
type Alt(A, B) = Nil | Cons(A, Alt(B, A))
type Tag(T)   = {name: Text}
slot n : Int = 0
reducer inc on=ui.click(B) do= n := n + 1
tile B = button(text="+1", onClick=inc)
app A caps=[] routes={"/" -> B, "/404" -> B} init=[]
`;

/** A program whose one property-test generates `x` of type `type`, after `decls`. */
function program(type: string, decls = ""): string {
  return `${PRELUDE}${decls}
test p = property-test
  for-all   = {x: ${type}}
  given     = {slots: {}, event: {type: ui.click, target: B}}
  invariant = true`;
}

/** The descriptor the generated test module hands the runtime's generator for `x`. */
function descriptor(type: string, decls = ""): unknown {
  const { js } = codegen(parse(lex(program(type, decls))), {
    runtimeSpecifier: "x",
    includeTests: true,
  });
  const vars = /vars: \{ "x": (.+) \},\n/.exec(js)?.[1];
  if (vars === undefined) throw new Error("no `vars` in the generated test module");
  return JSON.parse(vars);
}

describe("the descriptor a for-all type is generated from", () => {
  it("builds a tuple from its elements, each with its own refinement", () => {
    expect(descriptor("Tuple(Text where nonempty, Int where negative)")).toEqual({
      t: "Tuple",
      items: [
        { t: "Text", minLen: 1 },
        { t: "Int", max: -1 },
      ],
    });
  });

  it("reads a generic's body with its parameter bound to the argument", () => {
    expect(descriptor("Box(Int where positive)")).toEqual({
      t: "Record",
      fields: [{ name: "v", desc: { t: "Int", min: 1 } }],
    });
  });

  it("generates Unit as its one value", () => {
    expect(descriptor("Unit")).toEqual({ t: "Unit" });
  });

  it("marks the variant a recursive union ends at", () => {
    expect(descriptor("Tree")).toEqual({
      t: "Fix",
      name: "Tree",
      body: {
        t: "Union",
        variants: [
          { name: "Leaf", payloads: [] },
          { name: "Node", payloads: [{ t: "Int" }, { t: "Rec", name: "Tree" }] },
        ],
        base: [0],
      },
    });
  });

  it("marks where two types that recurse through each other end", () => {
    // `Term` holds an `Expr` in every case, so `Lit` is the only way out.
    expect(descriptor("Expr")).toMatchObject({
      t: "Fix",
      name: "Expr",
      body: { t: "Union", base: [0] },
    });
  });

  it("marks the outcome a recursive Result ends at", () => {
    const decls = "\ntype Steps = Result(Int, Steps)";
    expect(descriptor("Steps", decls)).toEqual({
      t: "Fix",
      name: "Steps",
      body: { t: "Result", ok: { t: "Int" }, err: { t: "Rec", name: "Steps" }, base: ["Ok"] },
    });
  });

  it("leaves a type with no recursion in it unmarked", () => {
    expect(descriptor("Result(Int, Text)")).toEqual({
      t: "Result",
      ok: { t: "Int" },
      err: { t: "Text" },
    });
    expect(descriptor("Map(Text, Tuple(Int, Bool))")).toEqual({
      t: "Map",
      key: { t: "Text" },
      val: { t: "Tuple", items: [{ t: "Int" }, { t: "Bool" }] },
    });
  });

  it("steps back into the instantiation a generic that swaps its parameters reaches again", () => {
    // `Alt(Text, Int)` is a type of its own, entered once, inside which `Alt(Int, Text)` comes round.
    expect(descriptor("Alt(Int, Text)")).toEqual({
      t: "Fix",
      name: "Alt(Int, Text)",
      body: {
        t: "Union",
        variants: [
          { name: "Nil", payloads: [] },
          {
            name: "Cons",
            payloads: [
              { t: "Int" },
              {
                t: "Union",
                variants: [
                  { name: "Nil", payloads: [] },
                  { name: "Cons", payloads: [{ t: "Text" }, { t: "Rec", name: "Alt(Int, Text)" }] },
                ],
                base: [0],
              },
            ],
          },
        ],
      },
    });
  });
});

describe("the refinements a for-all type stacks", () => {
  it.each<[string, string, unknown]>([
    ["keeps the tighter of two bounds", "Pos where between(-5, 5)", { t: "Int", min: 1, max: 5 }],
    [
      "keeps the longer of two least lengths",
      "Text where len-gt(3) where nonempty",
      { t: "Text", minLen: 4 },
    ],
    [
      "bounds an Int by the whole numbers inside",
      "Int where between(0.5, 2.5)",
      { t: "Int", min: 1, max: 2 },
    ],
    [
      "keeps a length beside a shape",
      "Text where email where len-lt(20)",
      { t: "Text", form: "email", maxLen: 19 },
    ],
    [
      "keeps only the `one-of` values the rest pass",
      "Int where between(0, 10) where one-of(-1, 7, 51)",
      { t: "Int", min: 0, max: 10, oneOf: [7] },
    ],
    [
      "filters a `one-of` by a pattern",
      `Text where regex("[a-z]+") where one-of("ab", "A1", "cd")`,
      { t: "Text", oneOf: ["ab", "cd"] },
    ],
  ])("%s", (_, type, want) => {
    expect(descriptor(type)).toEqual(want);
  });

  it("reads a chain of forty definitions of 250 `where`s each", () => {
    const decls = Array.from({ length: 40 }, (_, i) => {
      const preds = Array.from({ length: 250 }, (_, w) =>
        i === 20 && w === 0 ? "between(0, 50)" : "between(-1000, 1000)",
      );
      return `\ntype T${i} = ${i === 0 ? "Int" : `T${i - 1}`}${preds.map((p) => ` where ${p}`).join("")}`;
    }).join("");
    expect(descriptor("T39", decls)).toEqual({ t: "Int", min: 0, max: 50 });
  });
});

describe("a for-all type the generator builds", () => {
  it.each([
    ["a tuple", "Tuple(Text, Int where negative)"],
    ["a tuple inside a collection", "Map(Tuple(Int, Int), Text)"],
    ["a generic applied to an argument", "Box(Int)"],
    ["a generic that recurses on its own argument", "Seq(Text)"],
    ["a generic inside itself", "Seq(Seq(Int))"],
    ["Unit", "Unit"],
    ["a recursive union", "Tree"],
    ["a record that recurses through an Option", "Chain"],
    ["a record that recurses through a List", "Rose"],
    ["two types that recurse through each other", "Expr"],
    ["a generic reached again under another argument", "Annot(Int)"],
    ["a generic that swaps two different arguments", "Alt(Int, Text)"],
    ["a generic that swaps two equal arguments", "Alt(Int, Int)"],
    ["a generic that holds none of its argument", "Tag(File)"],
  ])("accepts %s", (_, type) => {
    expect(summariesOf(program(type))).toEqual([]);
  });
});

describe("a for-all type the generator cannot build", () => {
  it.each([
    ["a record that holds itself on every path", "Inf", '"Inf" has no finite value'],
    ["a union whose variant holds such a record", "Holder", '"Inf" has no finite value'],
    ["a File", "File", '"File" has none'],
    ["an EffectId", "EffectId", '"EffectId" has none'],
    ["a tuple holding a File", "Tuple(Int, File)", '"File" has none'],
    ["a FormData, whose FileV variant holds a File", "FormData", '"File" has none'],
    ["a FormValue, whose FileV variant holds a File", "FormValue", '"File" has none'],
    [
      "an HttpStatus refined past its own bounds",
      "HttpStatus where between(700, 800)",
      'the refinements of "HttpStatus" leave no value: none is at least 700 and at most 599',
    ],
    [
      "a generic that nests a parameter deeper",
      "Grow(Int)",
      '"Grow" nests a parameter deeper at every step: "Grow(List(Int))" inside "Grow(Int)"',
    ],
    [
      "bounds that cross",
      "Int where positive where negative",
      'the refinements of "Int" leave no value: none is at least 1 and at most -1',
    ],
    [
      "bounds with no whole number between them",
      "Int where between(0.2, 0.8)",
      'the refinements of "Int" leave no value: none is at least 1 and at most 0',
    ],
    [
      "lengths that cross",
      "Text where len-gt(5) where len-lt(3)",
      'the refinements of "Text" leave no value: none is at least 6 and at most 2 characters long',
    ],
    [
      "two shapes",
      "Text where email where url",
      'the refinements of "Text" leave no value: none is both an email and a url',
    ],
    [
      "a shape shorter than its least length",
      "Text where email where len-lt(5)",
      'the refinements of "Text" leave no value: an email is at least 5 characters long',
    ],
    [
      "a uuid of another length",
      "Text where uuid where len-gt(36)",
      'the refinements of "Text" leave no value: a uuid is 36 characters long',
    ],
    [
      "a `one-of` whose every value another refinement refuses",
      "Int where one-of(1, 2) where between(5, 9)",
      'the refinements of "Int" leave no value: no value its `one-of` lists passes the rest',
    ],
  ])("refuses %s, at the for-all field", (_, type, reason) => {
    const source = program(type);
    const ds = checkSource(source);
    expect(ds.map((d) => d.code)).toEqual(["E0715"]);
    const [d] = ds as [KumikiError];
    expect(d.message).toBe(`No generator for \`for-all\` "x": ${reason}`);
    expect(textAt(source, d.pos)).toMatch(/^x: /);
  });

  it.each([
    ["a name that resolves to nothing", "Nope", "", "E0117"],
    ["a definition it reaches that names nothing", "W", "\ntype W = {b: Nope}", "E0117"],
    ["an alias that resolves to itself", "A1", "\ntype A1 = B1\ntype B1 = A1", "E0009"],
    ["a bare Tuple", "Tuple", "", "E0210"],
    ["a generic without its argument", "Box", "", "E0210"],
  ])("leaves %s to its own code", (_, type, decls, code) => {
    expect(codesOf(program(type, decls))).toEqual([code]);
  });

  it("stops codegen for a caller that skipped check", () => {
    expect(() =>
      codegen(parse(lex(program("Inf"))), { runtimeSpecifier: "x", includeTests: true }),
    ).toThrow('E0715 No generator for `for-all` "x": "Inf" has no finite value');
  });
});
