// An argument a value builtin never renders is E0129.
//
// A value builtin reads its content from one place: its first positional
// argument, or — for `label`, `link` and `editable` — `text=` when no
// positional one is written; `image` and `icon` read `src=` / `name=`
// (language.md §1.7.1, stdlib.md §2.3). Anything else written as content is
// dropped by the lowering, and `check`, `build` and `smoke` were all green:
//
// - `heading(text="Title")` renders "" — `text=` is a prop there, the label
//   argument of `button` / `link` / `label` / `editable`;
// - `text("A", "B")` renders "A", and "B" goes nowhere;
// - `image("a.png", alt="a")` renders no source.

import { check, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

const program = (tile: string) => `slot title : Text = "Title"
tile App = column(${tile})
app P caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;

const diagnostics = (tile: string) =>
  check(parse(lex(program(tile)))).map((e) => `${e.code} ${e.pos.line}:${e.pos.col} ${e.message}`);

const codes = (tile: string) => check(parse(lex(program(tile)))).map((e) => e.code);

// `column(` is 18 columns wide on line 2, so an argument's column is 19 plus
// its offset in the call.
const at = (tile: string, arg: string) => 19 + tile.indexOf(arg);

describe("content written as text= on a text builtin", () => {
  it.each(["text", "heading", "markdown", "code"])("%s(text=…) is E0129 at text=", (b) => {
    const tile = `${b}(text="Hi")`;
    expect(diagnostics(tile)).toEqual([
      `E0129 2:${at(tile, "text=")} content is positional: write \`${b}("…")\` — \`text=\` is a prop on ${b} and never renders (it is the label argument of button, link, label and editable)`,
    ]);
  });

  it("is reported beside other named arguments", () => {
    expect(codes(`heading(level=2, text=title)`)).toEqual(["E0129"]);
  });

  it("is not reported when the content is also written positionally", () => {
    // `text=` is then a prop like any other; the call renders its content.
    expect(codes(`text(title, text="x")`)).not.toContain("E0129");
  });

  it.each([
    'label(text="Name")',
    'link(to="/x", text="Home")',
    'editable(text="draft")',
  ])("is not reported on %s, which takes it as its label", (tile) => {
    expect(codes(tile)).toEqual([]);
  });
});

describe("a positional argument the builtin never reads", () => {
  it("a second positional on a text builtin is E0129 at the dropped argument", () => {
    const tile = `text("FirstA", "SecondB")`;
    expect(diagnostics(tile)).toEqual([
      `E0129 2:${at(tile, '"SecondB"')} text renders its first positional argument only — positional argument 2 is never rendered. Join the values (\`a + b\`, \`fmt(…)\`) or give each its own text`,
    ]);
  });

  it("reports every dropped argument, each at its own position", () => {
    const tile = `heading(title, "b", "c")`;
    expect(diagnostics(tile).map((d) => d.split(" ").slice(0, 2).join(" "))).toEqual([
      `E0129 2:${at(tile, '"b"')}`,
      `E0129 2:${at(tile, '"c"')}`,
    ]);
  });

  it.each([
    ['label("A", "B")', "label"],
    ['link("A", "B", to="/x")', "link"],
    ['editable("A", "B")', "editable"],
  ])("%s reports its second positional", (tile) => {
    expect(codes(tile)).toEqual(["E0129"]);
  });

  it.each([
    ['image("a.png", alt="a")', "image", "src"],
    ['icon("home")', "icon", "name"],
  ])("%s reports a positional, which it does not read", (tile, b, named) => {
    expect(diagnostics(tile)).toEqual([
      `E0129 2:${at(tile, '"')} ${b} takes its ${named} as \`${named}=\` — a positional argument is never rendered. Write \`${b}(${named}=…)\``,
    ]);
  });
});

describe("what each builtin does read is not reported", () => {
  it.each([
    "text(title)",
    'heading(level=2, title, test-id="h")',
    'code(lang="ts", title)',
    'label("Name")',
    'link("Home", to="/x")',
    'editable(text="A", "B")',
    'image(src="a.png", alt="a")',
    'icon(name="home")',
    'text(test-id="probe")',
  ])("%s", (tile) => {
    expect(codes(tile)).toEqual([]);
  });
});
