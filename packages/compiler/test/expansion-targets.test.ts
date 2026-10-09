// `expansionTargets` on its own, as a table over tile bodies, and the checks
// that read the edges it gives.
//
// An edge is a name a tile body renders as a tile: a call, the branches of
// `for` / `when` / `if` / `match`, and an identifier written as a positional
// argument where a tile belongs. The last is the one that needs the callee to
// decide it. A value builtin's content and a user tile's input are values, so
// an identifier there is read as one — a slot or a bind — whatever tile
// happens to share its name, and adds no edge. Every reader of the graph sees
// the difference: E0005 looks for a loop along these edges, and W0212 / W0213
// read the builtin kinds a tile renders off them.

import { describe, expect, it } from "vitest";
import type { Program, TileDef } from "../src/ast.ts";
import { expansionTargets } from "../src/def-graph.ts";
import { lex } from "../src/lexer.ts";
import { parse } from "../src/parser.ts";
import { check } from "../src/typecheck.ts";

/** The names `tile T = <body>` expands into, in the order the walk meets them. */
function targets(body: string): string[] {
  const program: Program = parse(lex(`tile T = ${body}\n`));
  const def = program.defs.find((d): d is TileDef => d.kind === "TileDef");
  if (!def) throw new Error("no tile in the fixture");
  return expansionTargets(def.body).map((e) => e.to);
}

describe("expansionTargets", () => {
  // Builtins are included: the caller filters against the tiles it knows, so
  // `column` here is an edge this function gives and `checkCycles` drops.
  const table: [string, string, string[]][] = [
    ["a container's positional identifier", `column(leaf)`, ["column", "leaf"]],
    ["a row's positional identifier", `row(text("x"), leaf)`, ["row", "text", "leaf"]],
    ["a card's positional identifier", `card(leaf)`, ["card", "leaf"]],
    ["text's content", `column(text(leaf))`, ["column", "text"]],
    ["heading's content", `column(heading(leaf))`, ["column", "heading"]],
    ["markdown's content", `column(markdown(leaf))`, ["column", "markdown"]],
    ["code's content", `column(code(leaf))`, ["column", "code"]],
    ["label's content", `column(label(leaf))`, ["column", "label"]],
    ["link's content", `column(link(leaf, to="/"))`, ["column", "link"]],
    ["editable's content", `column(editable(leaf))`, ["column", "editable"]],
    ["a value builtin at the root", `text(leaf)`, ["text"]],
    // The callee is rendered; its input is a value, read as `$1` in its body.
    ["a user tile's input", `column(Card(leaf))`, ["column", "Card"]],
    ["a user tile's input beside a child", `column(Card(leaf), leaf)`, ["column", "Card", "leaf"]],
    ["a named argument", `column(text("x"), c=leaf)`, ["column", "text"]],
    ["content under when", `column(when(true, text(leaf)))`, ["column", "text"]],
    ["a child under when", `column(when(true, column(leaf)))`, ["column", "column", "leaf"]],
    [
      "content and a child under if",
      `if true then text(leaf) else column(leaf)`,
      ["text", "column", "leaf"],
    ],
    ["content under for", `for i in [1] text(leaf)`, ["text"]],
    [
      "content and a child under match",
      `match o with | Some(n) -> text(leaf) | None -> column(leaf)`,
      ["text", "column", "leaf"],
    ],
  ];
  for (const [what, body, expected] of table) {
    it(`${what}: ${body}`, () => {
      expect(targets(body)).toEqual(expected);
    });
  }
});

describe("the checks that read the edges", () => {
  const TAIL = `app M caps=[] routes={"/" -> App, "/404" -> App} init=[]\n`;
  const codes = (src: string) => check(parse(lex(`${src}\n${TAIL}`))).map((e) => e.code);

  // A slot named after a builtin, shown as text. Nothing in `Row` fires a
  // click — `button` there is the slot's value — so both warnings stand.
  const PRELUDE = `slot button : Text = "label"
slot n : Int = 0
reducer tap on=ui.click(_) do= n := n + 1
tile Row = row(text(button))`;

  it("W0212 does not count a slot read as content as a rendered builtin", () => {
    expect(
      codes(`${PRELUDE}\nreducer R on=ui.click(Row) do= n := n + 1\ntile App = column(Row)`),
    ).toEqual(["W0212"]);
  });

  it("W0213 does not count a slot read as content as a rendered builtin", () => {
    expect(codes(`${PRELUDE}\ntile App = column(Row {onClick: tap})`)).toEqual(["W0213"]);
  });

  it("both still see a builtin the tile does render", () => {
    // The control: a `button` written as a child is a rendered kind, so the
    // subscription and the handler are wired and neither is reported.
    const wired = `slot n : Int = 0
reducer tap on=ui.click(_) do= n := n + 1
tile Row = row(button(text="go"))`;
    expect(
      codes(`${wired}\nreducer R on=ui.click(Row) do= n := n + 1\ntile App = column(Row)`),
    ).toEqual([]);
    expect(codes(`${wired}\ntile App = column(Row {onClick: tap})`)).toEqual([]);
  });
});
