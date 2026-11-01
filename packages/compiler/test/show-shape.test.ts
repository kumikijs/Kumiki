import { describe, expect, it } from "vitest";
import type { Program, ShowShape, TypeDef } from "../src/ast.ts";
import { lex } from "../src/lexer.ts";
import { parse } from "../src/parser.ts";
import { showShapeOf } from "../src/show-shape.ts";
import { summariesOf } from "./helpers/diagnostics.ts";
import { withApp } from "./helpers/programs.ts";

const DEFS = `type Id = nominal Int
type Counts = nominal Map(Text, Int)
type Box(T) = {v: T}
type Tree = {label: Text, kids: List(Tree)}
type Marked = {label: Text, kids: List(Marked), marks: Set(Int)}
type N(T) = {v: T, kids: List(N(List(T)))}
type M(T) = {m: Map(Text, T), kids: List(M(List(T)))}
type P(T) = {q: List(Q(T))}
type Q(T) = {s: Set(Int), p: List(P(List(T)))}`;

/** The shape the checker records where a value of type `expr` is shown. */
function shapeOf(expr: string): ShowShape {
  const program: Program = parse(lex(`${DEFS}\ntype Probe = ${expr}`));
  const defs = program.defs.filter((d): d is TypeDef => d.kind === "TypeDef");
  const types = new Map(defs.map((d) => [d.name, d]));
  const probe = types.get("Probe");
  if (!probe) throw new Error("no Probe in the fixture");
  types.delete("Probe");
  return showShapeOf(probe.body, { types });
}

describe("showShapeOf", () => {
  it.each<[string, string, ShowShape]>([
    ["a Map through `nominal`", "Counts", ["m", 0, 0, 0]],
    ["a key through `where`", "Map(Int where positive, Text)", ["m", "number", 0, 0]],
    ["a nominal Int key", "Map(Id, Text)", ["m", "number", 0, 0]],
    ["a Set of a refined nominal", "Set(nominal Int where positive)", ["s", "number", 0]],
    ["a type that contains itself and no Map, Set or Tuple", "Tree", 0],
    ["a List of such a type", "List(Tree)", 0],
    [
      "a Box nested in a Box, which is nesting and not recursion",
      "Box(Box(Map(Text, Int)))",
      {
        v: { v: ["m", 0, 0, 0] },
      },
    ],
    ["a generic whose recursion grows its argument", "N(Int)", 0],
    ["the Map above where such a generic first repeats", "M(Int)", { m: ["m", 0, 0, 0] }],
    [
      "two generics that grow each other's argument",
      "P(Int)",
      {
        q: ["l", { s: ["s", "number", 0] }],
      },
    ],
  ])("%s: %s", (_, expr, expected) => {
    expect(shapeOf(expr)).toEqual(expected);
  });

  it("refers back to itself for a type that contains itself and a Set", () => {
    const shape = shapeOf("Marked") as { kids: readonly ["l", ShowShape]; marks: ShowShape };
    expect(shape.marks).toEqual(["s", "number", 0]);
    expect(shape.kids[1]).toBe(shape);
  });

  it("checks a program that shows a generic whose recursion grows its argument", () => {
    const src = withApp(`type N(T) = {v: T, kids: List(N(List(T)))}
slot n : N(Int) = {v: 1, kids: []}
tile App = column(text("n: " + n))`);
    expect(summariesOf(src)).toEqual([]);
  });
});
