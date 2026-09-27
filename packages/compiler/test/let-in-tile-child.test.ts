// A `let` is not a tile (language.md §1.7.1: `tile-expr` is a call, a `match`
// or control flow; §1.13 lists `let` in a tile body as a counterexample). As a
// child of a container it used to pass `check` — parsed as a value argument —
// while codegen dropped the child, so `column(let x = 42 in Card(x))` mounted
// an empty root. The tile call under it was never checked either: a wrong
// argument to `Card` passed, and a builtin under it was looked up as a `fn`.
//
// It is E0128 at the `let`, whatever it binds, and nothing inside it is
// reported on top.

import { check, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

const program = (home: string) => `tile Card in={label: Text} = text($1.label)
tile Home = ${home}
app R
    caps   = []
    routes = {"/" -> Home, "/404" -> Home}
    init   = []
`;

const diagnostics = (home: string) =>
  check(parse(lex(program(home)))).map((e) => `${e.code} ${e.pos.line}:${e.pos.col} ${e.message}`);

const E0128 = (col: number) =>
  `E0128 2:${col} A \`let\` is not a tile: a tile body has no local bindings, so a \`let\` written as a child renders nothing. Write the value where it is used, or compute it in a \`fn\``;

describe("a let written as a child tile", () => {
  it.each([
    ["an argument of the wrong type", "column(let x = 42 in Card(x))"],
    ["the Unit value", "column(let x = () in Card(x))"],
    ["an argument of the right type", `column(let x = {label: "a"} in Card(x))`],
    ["a builtin in its body", "column(let x = 42 in text(x.show))"],
  ])("is E0128 at the let, binding %s", (_, home) => {
    expect(diagnostics(home)).toEqual([E0128(20)]);
  });

  it("is reported beside a sibling that renders", () => {
    expect(diagnostics(`column(heading("h"), let x = () in Card(x))`)).toEqual([E0128(34)]);
  });

  it("is reported in any container that takes children", () => {
    expect(diagnostics(`row(text("a"), let x = 1 in Card({label: x.show}))`)).toEqual([E0128(28)]);
  });
});

describe("a let where a value belongs is still a value", () => {
  it.each([
    ["the content of a text builtin", `column(text(let x = 1 in x.show))`],
    ["a user tile's input", `column(Card(let x = "a" in {label: x}))`],
    ["a named argument", `column(button(text=let x = "go" in x))`],
  ])("accepts it as %s", (_, home) => {
    expect(diagnostics(home)).toEqual([]);
  });
});
