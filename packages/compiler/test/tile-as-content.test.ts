import { VALUE_ARG_BUILTINS } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import {
  checkSource,
  codesOf,
  locatedSummariesOf,
  pointedErrorsOf,
  tileAsContentMessage,
} from "./helpers/diagnostics.ts";

const program = (home: string, more = "") => `tile Header = text("header")
tile Card in={label: Text} = text($1.label)
tile lower = text("lower")
tile Home = ${home}
type Shape = Circle | Square
slot shape : Shape = Circle
slot pick : Option(Int) = None
slot c : Bool = true
slot s : Text = ""
slot n : Int = 0
slot xs : List(Int) = [1, 2]
${more}app R
    caps   = []
    routes = {"/" -> Home, "/404" -> Home}
    init   = []
`;

const codes = (home: string, more?: string) => codesOf(program(home, more));

/**
 * The errors of `home`, each with the source text it points at cut to the length of the tile
 * expected at that place, so a position is read rather than counted.
 */
const reported = (home: string, starts: readonly string[], more?: string) =>
  pointedErrorsOf(program(home, more)).map((e, i) => ({
    code: e.code,
    message: e.message,
    at: e.text.slice(0, starts[i]?.length),
  }));

/** E0236 at each of `starts`, as `builtin` words it. */
const tilesAt = (starts: readonly string[], builtin = "text", shown = "text(x.show)") =>
  starts.map((at) => ({ code: "E0236", message: tileAsContentMessage(builtin, shown), at }));

const builtins: readonly (readonly [string, string, (x: string) => string, string])[] = [
  ["text", "text", (x) => `text(${x})`, "text(x.show)"],
  ["heading", "heading", (x) => `heading(${x})`, "heading(x.show)"],
  ["markdown", "markdown", (x) => `markdown(${x})`, "markdown(x.show)"],
  ["code", "code", (x) => `code(${x})`, "code(x.show)"],
  ["label", "label", (x) => `label(${x})`, "label(x.show)"],
  ["label as text=", "label", (x) => `label(text=${x})`, "label(text=x.show)"],
  ["link", "link", (x) => `link(${x}, to="/")`, "link(x.show)"],
  ["link as text=", "link", (x) => `link(to="/", text=${x})`, "link(text=x.show)"],
  ["editable", "editable", (x) => `editable(${x}, bind=s)`, "editable(x.show)"],
  ["editable as text=", "editable", (x) => `editable(bind=s, text=${x})`, "editable(text=x.show)"],
  ["image", "image", (x) => `image(src=${x}, alt="a")`, "image(src=x.show)"],
  ["icon", "icon", (x) => `icon(name=${x})`, "icon(name=x.show)"],
];

const tiles: readonly (readonly [string, string, readonly string[]])[] = [
  ["a when", "when(c, Header)", ["when"]],
  ["a for", "for x in xs Header", ["for"]],
  ["a builtin's call", `column(text("a"))`, ["column"]],
  ["a call of a tile the program defines", `Card({label: "a"})`, ["Card"]],
  ["a call of a lower-cased tile", "lower()", ["lower"]],
  ["the name of a tile the program defines", "Header", ["Header"]],
  ["the name of a lower-cased tile", "lower", ["lower"]],
  ["the tile arms of an if", `if c then Header else column(text("a"))`, ["Header", "column"]],
  [
    "the tile arms of a match",
    `match shape with | Circle -> Header | Square -> text("a")`,
    ["Header", `text("a")`],
  ],
  ["the body of a let", "let x = 1 in Header", ["Header"]],
];

it("is E0236 at a when as text's content", () => {
  const src = `tile App = column(text(when(true, column(text("inner")))))
app M
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;
  expect(locatedSummariesOf(src)).toEqual([
    `E0236 1:24 ${tileAsContentMessage("text", "text(x.show)")}`,
  ]);
});

it("covers every value builtin", () => {
  expect(new Set(builtins.map(([, name]) => name))).toEqual(VALUE_ARG_BUILTINS);
});

describe.each(builtins)("a tile as the content of %s", (_, builtin, write, shown) => {
  it.each(tiles)("is E0236 at %s", (_, tile, starts) => {
    expect(reported(write(tile), starts)).toEqual(tilesAt(starts, builtin, shown));
  });
});

describe("a tile in the content", () => {
  it.each([
    ["the tile arm of an if whose other arm is a value", `text(if c then "a" else Header)`],
    [
      "an arm of a nested if and match",
      `text(match pick with | Some(v) -> if c then v.show else Header | None -> "none")`,
    ],
    ["the body of a let in an arm of an if", `text(if c then let x = 1 in Header else "b")`],
    ["the body of a let in the body of a let", "text(let x = 1 in let y = 2 in Header)"],
  ])("is reported at %s", (_, home) => {
    expect(reported(home, ["Header"])).toEqual(tilesAt(["Header"]));
  });

  it("is reported once at a builtin's call as the body of a let", () => {
    const home = `text(let x = 1 in column(text("a")))`;
    expect(reported(home, ["column"])).toEqual(tilesAt(["column"]));
  });

  it("is reported at link's {text: …}, which link renders when no content is written", () => {
    const home = `link(to="/") {text: Header}`;
    expect(reported(home, ["Header"])).toEqual(tilesAt(["Header"], "link", "link {text: x.show}"));
  });

  it("is a builtin's call where a value, but no fn, has the builtin's name", () => {
    const home = `text(code("x"))`;
    expect(reported(home, ["code"], `slot code : Text = ""\n`)).toEqual(tilesAt(["code"]));
  });

  it("beside a second positional argument leaves that one to E0129", () => {
    expect(codes(`text(when(c, Header), "b")`)).toEqual(["E0129", "E0236"]);
  });

  it.each([
    ["inside a when", "text(when(nope, column(text(nope))))", "when"],
    ["inside a builtin's call", "text(column(nope))", "column"],
    ["inside a tile's call", "text(Card(42))", "Card"],
    ["beside the tile, in the if", `text(if nope then Header else nope)`, "Header"],
    ["the match's scrutinee", `text(match nope with | Circle -> Header | Square -> "b")`, "Header"],
    ["the let's value", "text(let x = nope in Header)", "Header"],
  ])("checks nothing else in the content: %s", (_, home, tile) => {
    expect(reported(home, [tile])).toEqual(tilesAt([tile]));
  });
});

describe("a value as the content is not reported", () => {
  it.each([
    ["a value match", `text(match shape with | Circle -> "a" | Square -> "b")`],
    ["a value if", `text(if c then "a" else "b")`],
    ["a value let", "text(let x = 1 in x.show)"],
    ["a join", `text("a" + n.show)`],
    ["a builtin call", `text(fmt("{0}", n))`],
    ["a link's label", `link("Home", to="/")`],
    ["a link's {text: …}", `link(to="/") {text: "Home"}`],
    ["a label's text", `label("x")`],
    ["an editable with no content", "editable(bind=s)"],
    ["a variant", "text(Circle)"],
    ["a when as a container's child", `column(when(c, text("x")))`],
    ["a loop variable named like a tile", "column(for lower in xs text(lower))"],
    ["a let variable named like a tile", `text(let lower = "a" in lower)`],
    [
      "a match binding named like a tile",
      "text(match pick with | Some(lower) -> lower | None -> 0)",
    ],
  ])("%s", (_, home) => {
    expect(codes(home)).toEqual([]);
  });

  it("is a fn's call where a fn has the builtin tile's name", () => {
    expect(codes("heading(label(1))", "fn label(x: Int) -> Text = x.show\n")).toEqual([]);
  });

  it("is a slot where a slot has the tile's name", () => {
    expect(codes("text(lower)", "slot lower : Int = 0\n")).toEqual([]);
  });

  it("is a loop variable of the tile's name read after its loop, which is E0103", () => {
    // Out of scope, as it is in a container: the read names the variable, not the tile.
    const errors = checkSource(program(`column(for lower in xs text("a"), text(lower))`));
    expect(errors.map((e) => [e.code, e.endedScope])).toEqual([["E0103", "for-expr"]]);
  });

  it.each([
    ["a type", "type Part = Header | Footer\n"],
    ["a slot's type", "slot part : Header | Footer = Footer\n"],
    ["a tile's in=", `tile Pick in=Header | Footer = text("p")\n`],
    ["a fn's parameter", "fn pick(p: Header | Footer) -> Int = 0\n"],
    ["a fn's return", "fn pick() -> Header | Footer = Footer\n"],
    [
      "an effect's in=",
      `effect save cap=storage.write in=Header | Footer out=Result(Unit, Text) map-request={key: "k", value: "v"}\n`,
    ],
    [
      "a property-test's for-all",
      `test t =
    property-test
        for-all   = {p: Header | Footer}
        given     = {slots: {n: 0}}
        invariant = true
`,
    ],
  ])("is a union's tag where %s declares the tile's name as one", (_, union) => {
    expect(codes("text(Header)", union)).toEqual([]);
    expect(codes(`text(if c then Header else "b")`, union)).toEqual([]);
  });

  it.each([
    ["HttpBody", "Empty"],
    ["Option", "Some"],
  ])("is %s's tag where a tile has the tag's name", (_, tag) => {
    expect(codes(`text(${tag})`, `tile ${tag} = text("t")\n`)).toEqual([]);
  });

  it("is a name for a builtin tile's name, which is no call", () => {
    expect(codes("text(code)")).toEqual(["E0103"]);
  });
});

it("is reported in a tile the content would expand into itself", () => {
  const src = `tile A = column(text(when(true, A)))
app M
    caps   = []
    routes = {"/" -> A, "/404" -> A}
    init   = []
`;
  expect(locatedSummariesOf(src)).toEqual([
    `E0236 1:22 ${tileAsContentMessage("text", "text(x.show)")}`,
  ]);
});
