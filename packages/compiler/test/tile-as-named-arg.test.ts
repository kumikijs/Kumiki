import { compile } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { checkSource, codesOf } from "./helpers/diagnostics.ts";

const program = (home: string) => `type Phase = Idle | Busy
slot phase : Phase = Idle
slot busy : Bool = false
slot xs : List(Int) = [1, 2]
tile Header = text("header")
tile Btn = button(text="go")
tile Home = ${home}
app R
    caps   = []
    routes = {"/" -> Home, "/404" -> Home}
    init   = []
`;

const diagnostics = (home: string) =>
  checkSource(program(home)).map((e) => `${e.code} ${e.pos.line}:${e.pos.col} ${e.message}`);

const codes = (home: string) => codesOf(program(home));

// `tile Home = ` is 12 columns wide on line 7.
const at = (home: string, tile: string) => `7:${13 + home.indexOf(tile)}`;

const message = (tile: string, name: string) =>
  `Named argument "${name}" on tile "${tile}" is a prop, and a prop's value cannot be a tile — ` +
  `nothing renders it. Write the tile as a positional child of a container — ` +
  `\`column(when(c, …))\` — or pass a value — \`${tile}(${name}=…)\``;

const callees: readonly (readonly [string, string, string, (x: string) => string])[] = [
  [
    "a builtin that renders no positional argument",
    "progress",
    "max",
    (x) => `progress(value=1, max=${x})`,
  ],
  ["a container", "box", "header", (x) => `box(header=${x}, text("body"))`],
  ["a control", "button", "disabled", (x) => `button(text="go", disabled=${x})`],
  ["a value builtin, beside its content", "text", "size", (x) => `text("a", size=${x})`],
  ["a value builtin whose content is named", "image", "alt", (x) => `image(src="a.png", alt=${x})`],
  ["a user tile", "Btn", "header", (x) => `column(Btn(header=${x}))`],
];

const tiles: readonly (readonly [string, string, string])[] = [
  ["a when", `when(busy, text("x"))`, "when"],
  ["a for", `for x in xs text("x")`, "for"],
];

describe.each(callees)("a tile as a named argument of %s", (_, tile, name, write) => {
  it.each(tiles)("is E0201 at %s", (_, value, start) => {
    const home = write(value);
    expect(diagnostics(home)).toEqual([`E0201 ${at(home, start)} ${message(tile, name)}`]);
  });
});

describe("a tile as a named argument", () => {
  it("is refused by build, which lowered it to undefined", () => {
    const result = compile(program(`column(progress(value=1, max=when(busy, text("x"))))`), {
      runtimeSpecifier: "@kumikijs/runtime",
    });
    expect(result.kind === "fail" && result.errors.map((e) => e.code)).toEqual(["E0201"]);
  });

  it("checks nothing inside it", () => {
    const home = "box(header=when(nope, text(nope)))";
    expect(diagnostics(home)).toEqual([`E0201 ${at(home, "when")} ${message("box", "header")}`]);
  });

  it("leaves a value builtin's named content to E0236", () => {
    expect(codes("label(text=when(busy, Header))")).toEqual(["E0236"]);
  });

  it.each(tiles)("leaves %s as an error's field to E0230", (_, value) => {
    expect(codes(`error(field=${value})`)).toEqual(["E0230"]);
  });

  it("leaves an event handler to the handler's own check", () => {
    const home = `button(text="go", onClick=when(busy, text("x")))`;
    expect(diagnostics(home)).toEqual([
      `E0201 ${at(home, "when")} Event handler arg "onClick" must be a reducer name`,
    ]);
  });
});

describe("a value as a named argument is not reported", () => {
  it.each([
    ["a value if", `button(text="go", disabled=if busy then true else false)`],
    ["a value if on a progress", "progress(value=1, max=if busy then 2 else 1)"],
    ["a value match", "progress(value=1, max=match phase with | Idle -> 1 | Busy -> 2)"],
  ])("%s", (_, home) => {
    expect(codes(home)).toEqual([]);
  });

  it("nor is the tile written as a container's positional child instead", () => {
    expect(codes(`box(when(busy, text("x")), text("body"))`)).toEqual([]);
  });
});
