// A `for-all` variable is generated or refused at build time (testing.md
// §8.3.2, errors.md E0715) — never handed to the trial as a `null` standing in
// for a value. A tuple, a generic applied to arguments, `Unit` and a recursive
// type with a value to stop at are generated; a type with no generator is
// refused at the `for-all` field that names it.

import { check, codegen, type KumikiError, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

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
slot n : Int = 0
reducer inc on=ui.click(B) do= n := n + 1
tile B = button(text="+1", onClick=inc)
app A caps=[] routes={"/" -> B, "/404" -> B} init=[]
`;

/** A program whose one property-test generates `x` of type `type`, on line 18. */
function program(type: string): string {
  return `${PRELUDE}
test p = property-test
  for-all   = {x: ${type}}
  given     = {slots: {}, event: {type: ui.click, target: B}}
  invariant = true`;
}

const diagnostics = (type: string): KumikiError[] => check(parse(lex(program(type))));

/** The descriptor the generated test module hands the runtime's generator for `x`. */
function descriptor(type: string): unknown {
  const { js } = codegen(parse(lex(program(type))), { runtimeSpecifier: "x", includeTests: true });
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
    // `Neg` steps into `Term`, which holds an `Expr` in every case, so `Lit`
    // is the only way out; `Term` itself ends at `note: None`.
    expect(descriptor("Expr")).toMatchObject({
      t: "Fix",
      name: "Expr",
      body: { t: "Union", base: [0] },
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
});

describe("a for-all type the generator builds", () => {
  it.each([
    ["a tuple", "Tuple(Text, Int where negative)"],
    ["a tuple inside a collection", "Map(Tuple(Int, Int), Text)"],
    ["a generic applied to an argument", "Box(Int)"],
    ["a generic that recurses on its own argument", "Seq(Text)"],
    ["Unit", "Unit"],
    ["a recursive union", "Tree"],
    ["a record that recurses through an Option", "Chain"],
    ["a record that recurses through a List", "Rose"],
    ["two types that recurse through each other", "Expr"],
  ])("accepts %s", (_, type) => {
    expect(diagnostics(type).map((d) => `${d.code} ${d.message}`)).toEqual([]);
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
    [
      "a type that applies itself to a different argument",
      "Grow(Int)",
      '"Grow" applies itself to a different argument',
    ],
  ])("refuses %s, at the for-all field", (_, type, reason) => {
    const ds = diagnostics(type);
    expect(ds.map((d) => d.code)).toEqual(["E0715"]);
    const [d] = ds as [KumikiError];
    expect(d.message).toBe(`No generator for \`for-all\` "x": ${reason}`);
    expect(d.pos).toEqual({ line: 18, col: 16 });
  });

  it("leaves a name that resolves to nothing to E0117", () => {
    expect(diagnostics("Nope").map((d) => d.code)).toEqual(["E0117"]);
  });

  it("stops codegen for a caller that skipped check", () => {
    expect(() =>
      codegen(parse(lex(program("Inf"))), { runtimeSpecifier: "x", includeTests: true }),
    ).toThrow('E0715 No generator for `for-all` "x": "Inf" has no finite value');
  });
});
