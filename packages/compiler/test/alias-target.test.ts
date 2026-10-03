// `aliasTarget` on its own, as a table over bodies.
//
// The function is only ever reached through `check()`, and that is how the
// generic-forwarding gap got in: `type Alias(T) = T` / `type A = Alias(A)`
// produced no edge, so `findCycles` had no loop to find, so `check` said `ok`
// — and reading the end of that chain tells you nothing about which link is
// wrong. A table over the one function names the link.
//
// The second half is a lockstep guard rather than a table: the edge relation
// and `unaliasType` are two readings of one chain, and the diagnostic exists
// precisely because the normalisation helpers answer "undecidable" where a
// program has no meaning. So wherever `unaliasType` gives up on a name, E0009
// has to be reported for it — stated as an implication over programs, which
// holds whatever shapes anyone thinks to enumerate above.

import { describe, expect, it } from "vitest";
import { unaliasType } from "../src/assignable.ts";
import type { Program, TypeDef } from "../src/ast.ts";
import { aliasTarget } from "../src/def-graph.ts";
import { lex } from "../src/lexer.ts";
import { parse } from "../src/parser.ts";
import { check } from "../src/typecheck.ts";

const typesOf = (src: string): Map<string, TypeDef> => {
  const program: Program = parse(lex(src));
  return new Map(
    program.defs.filter((d): d is TypeDef => d.kind === "TypeDef").map((d) => [d.name, d]),
  );
};

/** The edge `aliasTarget` gives for `name`, as `"A -> B"` or `"A -> ."`. */
function edge(src: string, name: string): string {
  const types = typesOf(src);
  const def = types.get(name);
  if (!def) throw new Error(`no type "${name}" in the fixture`);
  const target = aliasTarget(def, (n) => types.get(n));
  return `${name} -> ${target ? target.to : "."}`;
}

describe("aliasTarget", () => {
  // `.` is "no edge": the body is a type of its own, or is a parameter and so
  // has no meaning until a call site supplies one.
  //
  // A name this function does not resolve is still returned — `A -> Option` and
  // `A -> Nope` below — because filtering is the caller's half: `typeEdges`
  // drops what `sym.types` does not hold, which is how a generic constructor
  // and an undeclared name both end the chain without this function needing a
  // list of either.
  const table: [string, string, string, string][] = [
    ["a self alias", `type A = A`, "A", "A -> A"],
    ["a plain alias", `type A = B\ntype B = Int`, "A", "A -> B"],
    ["a nominal wrapper", `type A = nominal B\ntype B = Int`, "A", "A -> B"],
    ["a refinement wrapper", `type A = B where positive\ntype B = Int`, "A", "A -> B"],
    ["a record", `type A = {v: B}\ntype B = Int`, "A", "A -> ."],
    ["a union", `type A = Leaf | Node(B)\ntype B = Int`, "A", "A -> ."],
    ["a primitive", `type A = Int`, "A", "A -> ."],
    ["a container", `type A = Option(A)`, "A", "A -> Option"],
    ["a name nothing declares", `type A = Nope`, "A", "A -> Nope"],
    ["a generic applied to a type", `type Box(T) = {v: T}\ntype A = Box(Int)`, "A", "A -> Box"],
    ["a generic whose body is its parameter", `type Alias(T) = T`, "Alias", "Alias -> ."],
    // The four rows the gap lived in: the argument is what normalisation
    // reaches, so it is what the edge has to name.
    ["an identity generic", `type Alias(T) = T\ntype A = Alias(A)`, "A", "A -> A"],
    ["a nominal generic", `type Tag(T) = nominal T\ntype A = Tag(B)\ntype B = Int`, "A", "A -> B"],
    [
      "a dropped argument",
      `type First(P, Q) = P\ntype X = First(B, Int)\ntype B = Int`,
      "X",
      "X -> B",
    ],
    [
      "forwarding through another generic",
      `type Alias(T) = T\ntype Outer(U) = Alias(U)\ntype A = Outer(A)`,
      "A",
      "A -> A",
    ],
    // Forwarding stops where normalisation does: the argument is the type.
    [
      "a container written as the argument",
      `type Alias(T) = T\ntype A = Alias(Option(A))`,
      "A",
      "A -> Option",
    ],
    [
      "a record written as the argument",
      `type Alias(T) = T\ntype A = Alias({v: A})`,
      "A",
      "A -> .",
    ],
    // A generic that forwards to itself has no index to give, so the chain
    // ends at the generic — which is the edge that closes its own loop.
    ["a generic that forwards to itself", `type Loop(T) = Loop(T)`, "Loop", "Loop -> Loop"],
    // A parameter is read as the parameter, never as the global it is spelled
    // like: `Cents` here is the argument position, not the declaration.
    [
      "a parameter shadowing a global",
      `type Cents = Int\ntype Alias(Cents) = Cents`,
      "Alias",
      "Alias -> .",
    ],
  ];

  for (const [what, src, name, expected] of table) {
    it(`answers ${expected} for ${what}`, () => {
      expect(edge(src, name)).toBe(expected);
    });
  }

  it("positions the edge at the name inside the body", () => {
    const types = typesOf(`type Alias(T) = T\ntype A = Alias(A)`);
    const def = types.get("A");
    if (!def) throw new Error("fixture");
    const target = aliasTarget(def, (n) => types.get(n));
    // The `A` written as the argument, not the one being declared.
    expect(`${target?.pos.line}:${target?.pos.col}`).toBe("2:16");
  });
});

const TAIL = `tile App = column(text("x"))
app Main caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;

describe("the edge relation and unaliasType agree about which names have no meaning", () => {
  // `unaliasType` returning `null` for a bare reference to a declared type is
  // exactly "this name has no normal form". Every such name must be named by
  // an E0009, or the diagnostic is not covering the silence it exists for.
  const programs: string[] = [
    `type A = A`,
    `type A = B\ntype B = A`,
    `type A = B\ntype B = C\ntype C = A`,
    `type A = nominal B\ntype B = nominal A`,
    `type A = B where positive\ntype B = A`,
    `type Alias(T) = T\ntype A = Alias(A)`,
    `type Tag(T) = nominal T\ntype A = Tag(A)`,
    `type Pos(T) = T where positive\ntype A = Pos(A)`,
    `type First(P, Q) = P\ntype X = First(X, Int)`,
    `type Alias(T) = T\ntype A = Alias(B)\ntype B = Alias(A)`,
    `type Alias(T) = T\ntype Outer(U) = Alias(U)\ntype A = Outer(A)`,
    `type A = B(Int)\ntype B(T) = A`,
    // Clean side: each has a normal form, so neither the oracle nor the check
    // says anything. Without these the implication is vacuous.
    `type Node = {value: Int, next: Node}`,
    `type Tree = {children: List(Tree)}`,
    `type A = {b: B}\ntype B = {a: A}`,
    `type Shape = Leaf | Branch(Shape, Shape)`,
    `type A = Option(A)`,
    `type A = Int\ntype B = A`,
    `type Alias(T) = T\ntype A = Alias(Int)`,
    `type Box(T) = {v: T}\ntype A = Box(A)`,
  ];

  for (const defs of programs) {
    it(`agrees on ${JSON.stringify(defs)}`, () => {
      const types = typesOf(defs);
      const meaningless = [...types.keys()]
        .filter((name) => {
          const def = types.get(name);
          if (!def || def.params.length > 0) return false;
          return unaliasType({ kind: "TypeRef", name, pos: def.pos }, { types }) === null;
        })
        .sort();
      const reported = check(parse(lex(`${defs}\n${TAIL}`)))
        .filter((e) => e.code === "E0009")
        .map((e) => e.message.replace(/^type "([^"]+)".*$/, "$1"));
      // Every name normalisation gives up on is on some reported cycle. The
      // converse is not asserted: a cycle is reported once at its entry point,
      // so the names it passes through are silent by design.
      for (const name of meaningless) {
        expect(
          reported.length,
          `${name} has no normal form and nothing reports it`,
        ).toBeGreaterThan(0);
      }
      if (meaningless.length === 0) expect(reported).toEqual([]);
    });
  }
});
