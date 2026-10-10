import { lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { withRoot } from "./helpers/programs.ts";

const parsed = (defs: string) =>
  parse(
    lex(
      withRoot(
        "Go",
        `type Color = Red | Green | Blue
slot c : Color = Blue
slot a : Bool = false
slot b : Bool = true
tile Go = button(text="go")
${defs}`,
      ),
    ),
  ).defs;

describe("a | that no pattern and -> follow stays bool OR", () => {
  const rhs: [string, Record<string, unknown>][] = [
    ["b", { kind: "Ref", name: "b" }],
    ["b.c", { kind: "FieldAccess", base: { kind: "Ref", name: "b" }, field: "c" }],
    ["f(x)", { kind: "Call", callee: "f", args: [{ kind: "Ref", name: "x" }] }],
  ];
  const or = (shape: Record<string, unknown>) => ({
    kind: "BinOp",
    op: "|",
    lhs: { kind: "Ref", name: "a" },
    rhs: shape,
  });

  it.each(rhs)("in a value match's arm body: a | %s", (written, shape) => {
    const defs = parsed(
      `fn g(x: Color) -> Bool = match x with | Red -> a | ${written} | other -> b`,
    );
    expect(defs.find((d) => d.kind === "FnDef")).toMatchObject({
      body: {
        kind: "MatchExpr",
        arms: [
          { pattern: { kind: "PVariant", name: "Red" }, body: or(shape) },
          { pattern: { kind: "PBind", name: "other" }, body: { kind: "Ref", name: "b" } },
        ],
      },
    });
  });

  it.each(rhs)("in a statement match's arm body: a | %s", (written, shape) => {
    const defs = parsed(
      `reducer r on=ui.click(Go) do= match c with | Red -> a := a | ${written} | other -> a := b`,
    );
    expect(defs.find((d) => d.kind === "ReducerDef" && d.name === "r")).toMatchObject({
      do: [
        {
          kind: "MatchStmt",
          arms: [
            { pattern: { kind: "PVariant", name: "Red" }, body: [{ rhs: or(shape) }] },
            {
              pattern: { kind: "PBind", name: "other" },
              body: [{ rhs: { kind: "Ref", name: "b" } }],
            },
          ],
        },
      ],
    });
  });
});
