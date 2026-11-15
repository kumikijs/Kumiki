import { describe, expect, it } from "vitest";
import { checkSource, codesOf } from "./helpers/diagnostics.ts";

const program = (tile: string) => `slot title : Text = "Title"
tile App = column(${tile})
app P caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;

const diagnostics = (tile: string) =>
  checkSource(program(tile)).map((e) => `${e.code} ${e.pos.line}:${e.pos.col} ${e.message}`);

const codes = (tile: string) => codesOf(program(tile));

const shapes = (tile: string) =>
  checkSource(program(tile))
    .filter((e) => e.code === "E0129")
    .map((e) => e.unrendered);

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
