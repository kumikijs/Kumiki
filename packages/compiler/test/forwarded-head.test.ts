// `forwardedHead` on its own, as a table over argument expressions.
//
// It takes the generics at an argument's head that hand a parameter straight
// back, the step `unaliasType` takes, and nothing more: what it gives has to
// normalise to what it was given, so a head it cannot see through is left as
// written.

import { describe, expect, it } from "vitest";
import { forwardedHead, typeToString, unaliasType } from "../src/assignable.ts";
import type { Program, TypeDef } from "../src/ast.ts";
import { lex } from "../src/lexer.ts";
import { parse } from "../src/parser.ts";

const DEFS = `type Alias(T) = T
type Tag(T) = nominal T where nonempty
type Second(A, B) = B
type Swap(A, B) = Second(B, A)
type Box(T) = {v: T}
type Loop(T) = Loop(T)`;

/** `expr` read as a type, and the table of `DEFS` it is read against. */
function read(expr: string) {
  const program: Program = parse(lex(`${DEFS}\ntype Probe = ${expr}`));
  const defs = program.defs.filter((d): d is TypeDef => d.kind === "TypeDef");
  const types = new Map(defs.map((d) => [d.name, d]));
  const probe = types.get("Probe");
  if (!probe) throw new Error("no Probe in the fixture");
  types.delete("Probe");
  return { t: probe.body, env: { types } };
}

describe("forwardedHead", () => {
  const table: [string, string, string][] = [
    ["a generic whose body is its parameter", "Alias(Int)", "Int"],
    ["one inside another", "Alias(Alias(Alias(Text)))", "Text"],
    ["a nominal, looked through as normalisation does", "Tag(Text)", "Text"],
    ["the second of two parameters", "Second(Int, Text)", "Text"],
    ["through another two-parameter generic", "Swap(Int, Text)", "Int"],
    ["a container head, kept as written", "List(Alias(Int))", "List(Alias(Int))"],
    ["a container reached through the head", "Alias(List(Alias(Int)))", "List(Alias(Int))"],
    ["a record body, which is a type of its own", "Box(Alias(Int))", "Box(Alias(Int))"],
    ["a name nothing declares", "Nope(Alias(Int))", "Nope(Alias(Int))"],
    ["a generic that forwards only to itself", "Loop(Alias(Int))", "Loop(Alias(Int))"],
  ];

  it.each(table)("%s: %s is %s", (_, expr, expected) => {
    const { t, env } = read(expr);
    expect(typeToString(forwardedHead(t, env))).toBe(expected);
  });

  // The contract the walk in `appliedBaseProblems` relies on.
  it.each(table)("%s: normalises %s as it was", (_, expr) => {
    const { t, env } = read(expr);
    const after = unaliasType(forwardedHead(t, env), env);
    const before = unaliasType(t, env);
    expect(after && typeToString(after)).toBe(before && typeToString(before));
  });
});
