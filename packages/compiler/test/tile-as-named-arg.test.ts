import { describe, expect, it } from "vitest";
import {
  builtSummariesOf,
  codesOf,
  locatedSummariesOf,
  posOf,
  tileAsPropMessage,
} from "./helpers/diagnostics.ts";

/** `home` comes first, so a needle is found in it before the definitions. */
const program = (home: string, more = "") => `tile Home = ${home}
type Phase = Idle | Busy
slot phase : Phase = Idle
slot busy : Bool = false
slot draft : Text = ""
slot xs : List(Int) = [1, 2]
tile Header = text("header")
tile Btn = button(text="go")
tile Row in=Text = text($1)
${more}app R
    caps   = []
    routes = {"/" -> Home, "/404" -> Home}
    init   = []
`;

const diagnostics = (home: string, more?: string) => locatedSummariesOf(program(home, more));

const codes = (home: string) => codesOf(program(home));

/** The diagnostic `code` reports with `message` at the first `needle` in the program. */
const at = (home: string, needle: string, code: string, message: string, more?: string) => {
  const { line, col } = posOf(program(home, more), needle);
  return `${code} ${line}:${col} ${message}`;
};

/** E0201 at the first `needle` in the program, for a tile as `tile`'s named argument `name`. */
const tileAsProp = (home: string, needle: string, tile: string, name: string, more?: string) =>
  at(home, needle, "E0201", tileAsPropMessage(tile, name), more);

const callees: readonly (readonly [string, string, string, (x: string) => string])[] = [
  [
    "a builtin that renders no positional argument",
    "progress",
    "max",
    (x) => `progress(value=1, max=${x})`,
  ],
  ["a container", "box", "header", (x) => `box(header=${x}, text("body"))`],
  ["a container, under the name an error's field has", "box", "field", (x) => `box(field=${x})`],
  ["a control", "button", "disabled", (x) => `button(text="go", disabled=${x})`],
  ["a value builtin, beside its content", "text", "size", (x) => `text("a", size=${x})`],
  ["a value builtin whose content is named", "image", "alt", (x) => `image(src="a.png", alt=${x})`],
  ["a user tile", "Btn", "header", (x) => `column(Btn(header=${x}))`],
];

const tiles: readonly (readonly [string, string])[] = [
  ["a when", `when(busy, text("x"))`],
  ["a for", `for x in xs text("x")`],
];

describe.each(callees)("a tile as a named argument of %s", (_, tile, name, write) => {
  it.each(tiles)("is E0201 at %s", (_, value) => {
    const home = write(value);
    expect(diagnostics(home)).toEqual([tileAsProp(home, value, tile, name)]);
  });
});

describe.each(tiles)("%s as a named argument", (_, value) => {
  it("is E0201 beside an undefined tile's E0105", () => {
    const home = `column(Nope(header=${value}))`;
    expect(diagnostics(home)).toEqual([
      at(home, "Nope", "E0105", `Reference to undefined tile "Nope"`),
      tileAsProp(home, value, "Nope", "header"),
    ]);
  });

  it("is E0201 beside the arity error of a tile whose input is not written", () => {
    const home = `column(Row(header=${value}))`;
    expect(diagnostics(home)).toEqual([
      at(home, "Row", "E0213", `Tile "Row" expects 1 argument(s) but got 0`),
      tileAsProp(home, value, "Row", "header"),
    ]);
  });

  it("is E0230 alone as an error's field", () => {
    expect(codes(`column(error(field=${value}))`)).toEqual(["E0230"]);
  });

  it("is E0201 as the field of an error whose block writes one, which is the field shown", () => {
    const home = `column(error(field=${value}) {field: draft})`;
    expect(diagnostics(home)).toEqual([tileAsProp(home, value, "error", "field")]);
  });

  it("is E0201 as the field of an error in a tile-test's expect, beside its unread block", () => {
    const test = `test err-field =
    tile-test Home
        given  = {slots: {}}
        expect = error(field=${value}) {field: draft}
`;
    const home = "error(field=draft)";
    expect(diagnostics(home, test)).toEqual([
      tileAsProp(home, value, "error", "field", test),
      at(
        home,
        "field: draft",
        "E0230",
        "error() {field: …} is not read in a tile-test's expect, which compares named arguments " +
          "only — write error(field=…) (see docs/spec/forms.md)",
        test,
      ),
    ]);
  });

  it.each([
    ["text", "content is positional", (x: string) => `text(text=${x})`],
    ["link", "link renders its positional argument", (x: string) => `link("a", to="/", text=${x})`],
  ])("is E0129 alone as %s's unrendered text=", (_, says, write) => {
    const home = `column(${write(value)})`;
    expect(diagnostics(home)).toEqual([
      expect.stringMatching(new RegExp(`^${at(home, "text=", "E0129", says)}`)),
    ]);
  });

  it.each([
    ["a builtin", (x: string) => `button(text="go", onClick=${x})`],
    ["a user tile", (x: string) => `column(Btn(onClick=${x}))`],
  ])("is reported once as an event handler of %s, by the handler's own check", (_, write) => {
    const home = write(value);
    expect(diagnostics(home)).toEqual([
      at(home, value, "E0201", `Event handler arg "onClick" must be a reducer name`),
    ]);
  });
});

describe("a tile as a named argument", () => {
  it("is refused by build, which lowered it to nothing", () => {
    const home = `column(progress(value=1, max=when(busy, text("x"))))`;
    expect(builtSummariesOf(program(home))).toEqual([
      `E0201 ${tileAsPropMessage("progress", "max")}`,
    ]);
  });

  it("checks nothing inside it", () => {
    const home = "box(header=when(nope, text(nope)))";
    expect(diagnostics(home)).toEqual([tileAsProp(home, "when", "box", "header")]);
  });

  it("leaves a value builtin's named content to E0236", () => {
    expect(codes("label(text=when(busy, Header))")).toEqual(["E0236"]);
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
