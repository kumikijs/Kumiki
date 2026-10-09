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
    ["a generic that forwards to itself", `type Loop(T) = Loop(T)`, "Loop", "Loop -> Loop"],
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
