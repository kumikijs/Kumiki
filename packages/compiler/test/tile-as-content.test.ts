import { VALUE_ARG_BUILTINS } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { checkSource, codesOf } from "./helpers/diagnostics.ts";

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

const located = (src: string) =>
  checkSource(src).map((e) => `${e.code} ${e.pos.line}:${e.pos.col} ${e.message}`);

const diagnostics = (home: string, more?: string) => located(program(home, more));

const codes = (home: string, more?: string) => codesOf(program(home, more));

// `tile Home = ` is 12 columns wide on line 4.
const at = (home: string, tile: string) => `4:${13 + home.indexOf(tile)}`;

const message = (builtin: string, shown: string) =>
  `A tile is not a value: ${builtin} shows a value as its content, so this tile is never ` +
  `rendered. Write the tile as a child of a container — \`column(when(c, …))\` — or show a ` +
  `value — \`${shown}\``;

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
];

it("is E0236 at a when as text's content", () => {
  const src = `tile App = column(text(when(true, column(text("inner")))))
app M
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;
  expect(located(src)).toEqual([`E0236 1:24 ${message("text", "text(x.show)")}`]);
});

it("covers every value builtin", () => {
  expect(new Set(builtins.map(([, name]) => name))).toEqual(VALUE_ARG_BUILTINS);
});

describe.each(builtins)("a tile as the content of %s", (_, builtin, write, shown) => {
  it.each(tiles)("is E0236 at %s", (_, tile, starts) => {
    const home = write(tile);
    expect(diagnostics(home)).toEqual(
      starts.map((start) => `E0236 ${at(home, start)} ${message(builtin, shown)}`),
    );
  });
});

describe("a tile in the content", () => {
  it("is reported at the tile arm of an if whose other arm is a value", () => {
    const home = `text(if c then "a" else Header)`;
    expect(diagnostics(home)).toEqual([
      `E0236 ${at(home, "Header")} ${message("text", "text(x.show)")}`,
    ]);
  });

  it("is reported in an arm of a nested if and match", () => {
    const home = `text(match pick with | Some(v) -> if c then v.show else Header | None -> "none")`;
    expect(diagnostics(home)).toEqual([
      `E0236 ${at(home, "Header")} ${message("text", "text(x.show)")}`,
    ]);
  });

  it("beside a second positional argument leaves that one to E0129", () => {
    expect(codes(`text(when(c, Header), "b")`)).toEqual(["E0129", "E0236"]);
  });

  it.each([
    ["inside a when", "text(when(nope, column(text(nope))))", "when"],
    ["inside a builtin's call", "text(column(nope))", "column"],
    ["inside a tile's call", "text(Card(42))", "Card"],
    ["beside the tile, in the if", `text(if nope then Header else nope)`, "Header"],
  ])("checks nothing else in the content: %s", (_, home, tile) => {
    expect(diagnostics(home)).toEqual([
      `E0236 ${at(home, tile)} ${message("text", "text(x.show)")}`,
    ]);
  });
});

describe("a value as the content is not reported", () => {
  it.each([
    ["a value match", `text(match shape with | Circle -> "a" | Square -> "b")`],
    ["a value if", `text(if c then "a" else "b")`],
    ["a join", `text("a" + n.show)`],
    ["a builtin call", `text(fmt("{0}", n))`],
    ["a link's label", `link("Home", to="/")`],
    ["a label's text", `label("x")`],
    ["an editable with no content", "editable(bind=s)"],
    ["a variant", "text(Circle)"],
    ["a when as a container's child", `column(when(c, text("x")))`],
    ["a loop variable named like a tile", "column(for lower in xs text(lower))"],
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
  ])("is a union's tag where %s declares the tile's name as one", (_, union) => {
    expect(codes("text(Header)", union)).toEqual([]);
    expect(codes(`text(if c then Header else "b")`, union)).toEqual([]);
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
  expect(located(src)).toContain(`E0236 1:22 ${message("text", "text(x.show)")}`);
});
