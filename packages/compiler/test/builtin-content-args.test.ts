// An argument a value builtin never renders is E0129.
//
// A value builtin reads its content from one place: its first positional
// argument, or — for `label`, `link` and `editable` — `text=` when no
// positional one is written (so `text=` beside one is never read); `image` and `icon` read `src=` / `name=`
// (language.md §1.7.1, stdlib.md §2.3). Anything else written as content is
// dropped by the lowering, and `check`, `build` and `smoke` were all green:
//
// - `heading(text="Title")` renders "" — `text=` is a prop there, the label
//   argument of `button` / `link` / `label` / `editable`;
// - `text("A", "B")` renders "A", and "B" goes nowhere;
// - `label(text="A", "B")` renders "B", and "A" goes nowhere;
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

// Which argument each E0129 says is dropped — the structured field a repair
// keys off, so rewording the message cannot change what gets repaired.
const shapes = (tile: string) =>
  check(parse(lex(program(tile))))
    .filter((e) => e.code === "E0129")
    .map((e) => e.unrendered);

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

  it("says it is the text-prop shape", () => {
    expect(shapes(`heading(text=title)`)).toEqual(["text-prop"]);
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

describe("text= beside a positional argument on label / link / editable", () => {
  // These read `text=` only when no positional argument is written, so with
  // one written the `text=` value is content that never renders.
  it.each([
    ['label(text="A", "B")', "label"],
    ['link(to="/x", text="A", "B")', "link"],
    ['editable(text="A", "B")', "editable"],
    ['label("B", text="A")', "label"],
  ])("%s is E0129 at text=", (tile, b) => {
    expect(diagnostics(tile)).toEqual([
      `E0129 2:${at(tile, "text=")} ${b} renders its positional argument, so \`text=\` is never rendered — it is read only when no positional argument is written. Remove \`text=\` or the positional argument`,
    ]);
  });

  it("says it is the text-shadowed shape", () => {
    expect(shapes(`label(text="A", "B")`)).toEqual(["text-shadowed"]);
  });
});

describe("a positional argument the builtin never reads", () => {
  it("says it is the positional shape", () => {
    expect(shapes(`text("A", "B")`)).toEqual(["positional"]);
    expect(shapes(`icon("home")`)).toEqual(["positional"]);
  });

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
    // The form every builtin that renders no positional argument is reported
    // in: `unrendered-positional.test.ts`.
    expect(diagnostics(tile)).toEqual([
      `E0129 2:${at(tile, '"')} ${b} renders no positional argument, so this one is never rendered. Write it as \`${named}=\`, or show it beside the ${b}`,
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
    'editable(text="A")',
    'image(src="a.png", alt="a")',
    'icon(name="home")',
    'text(test-id="probe")',
  ])("%s", (tile) => {
    expect(codes(tile)).toEqual([]);
  });
});
