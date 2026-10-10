import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkSource, codesOf } from "./helpers/diagnostics.ts";

const program = (home: string) => `tile Card in={label: Text} = text($1.label)
tile Home = ${home}
tile lower = text("lower")
slot n : Int = 0
app R
    caps   = []
    routes = {"/" -> Home, "/404" -> Home}
    init   = []
`;

const diagnostics = (home: string) =>
  checkSource(program(home)).map((e) => `${e.code} ${e.pos.line}:${e.pos.col} ${e.message}`);

const codes = (home: string) => codesOf(program(home));

const message = (builtin: string) =>
  `A value is not a tile: ${builtin} renders a positional argument only when it is a tile, so this one renders nothing. Show the value with a tile — \`text(…)\` — or, for a \`let\`, write the value where it is used or compute it in a \`fn\``;

const E0128 = (home: string, value: string, builtin = "column") =>
  `E0128 2:${13 + home.indexOf(value)} ${message(builtin)}`;

describe("a value written as a child", () => {
  it.each([
    ["an Int", `column(text("a"), 42)`, "42"],
    ["a Text", `column(text("a"), "s")`, `"s"`],
    ["the Unit value", `column(text("a"), ())`, "()"],
    ["a record", `column(text("a"), {label: "x"})`, "{"],
    ["a member read on a slot", `column(text("a"), n.show)`, "n.show"],
    ["a slot, which lowered to a null child", `column(text("a"), n)`, "n)"],
  ])("is E0128 at the value: %s", (_, home, value) => {
    expect(diagnostics(home)).toEqual([E0128(home, value)]);
  });

  it.each([
    ["binding a value of the wrong type", "column(let x = 42 in Card(x))"],
    ["binding the Unit value", "column(let x = () in Card(x))"],
    ["binding a value of the right type", `column(let x = {label: "a"} in Card(x))`],
    ["with a builtin in its body", "column(let x = 42 in text(x.show))"],
  ])("is E0128 at a let %s", (_, home) => {
    expect(diagnostics(home)).toEqual([E0128(home, "let")]);
  });

  it("is E0128 once for a let with the tile in its binding", () => {
    const home = `column(let x = Card({label: "a"}) in x)`;
    expect(diagnostics(home)).toEqual([E0128(home, "let")]);
  });

  it("is reported beside a sibling that renders", () => {
    const home = `column(heading("h"), let x = () in Card(x))`;
    expect(diagnostics(home)).toEqual([E0128(home, "let")]);
  });

  it("is reported once per value", () => {
    const home = `column(let x = 1 in Card(x), text("a"), let y = 2 in Card(y))`;
    expect(diagnostics(home)).toEqual([E0128(home, "let x"), E0128(home, "let y")]);
  });

  it("is reported under a nested container, naming that container", () => {
    const home = "column(card(let x = 42 in Card(x)))";
    expect(diagnostics(home)).toEqual([E0128(home, "let", "card")]);
  });

  it("is reported in any builtin that is not a value builtin", () => {
    const row = `row(text("a"), let x = 1 in Card({label: x.show}))`;
    expect(diagnostics(row)).toEqual([E0128(row, "let", "row")]);
    const button = `column(button(42, text="go"))`;
    expect(diagnostics(button)).toEqual([E0128(button, "42", "button")]);
  });

  it("does not stop the rest of the check", () => {
    expect(codes(`column(Card(42), 7)`)).toEqual(["E0201", "E0128"]);
  });
});

describe("what renders in a child position is not reported", () => {
  it.each([
    ["a tile call", `column(text("a"), Card({label: "b"}))`],
    ["a when", `column(when(n > 0, text("a")))`],
    ["an if", `column(if n > 0 then text("a") else text("b"))`],
  ])("%s", (_, home) => {
    expect(codes(home)).toEqual([]);
  });
});

it("the name of a tile in a child position is not E0128", () => {
  expect(codes("column(lower)")).not.toContain("E0128");
});

describe("a value where a value belongs is still a value", () => {
  it.each([
    ["the content of a text builtin", `column(text(let x = 1 in x.show))`],
    ["a user tile's input", `column(Card(let x = "a" in {label: x}))`],
    ["a named argument", `column(button(text=let x = "go" in x))`],
    ["a literal as a text builtin's content", `column(text("a"), heading(n.show))`],
  ])("accepts it as %s", (_, home) => {
    expect(codes(home)).toEqual([]);
  });
});

describe("a let as a user tile's input is compared with its in=", () => {
  it.each([
    ["a value of the wrong type", "column(Card(let x = 42 in x))", "E0201"],
    ["a field of the wrong type", "column(Card(let x = {label: 42} in x))", "E0201"],
  ])("reports %s", (_, home, code) => {
    expect(codes(home)).toEqual([code]);
  });

  it("accepts a value of the right type built from the binding", () => {
    expect(codes(`column(Card(let x = "a" in {label: x}))`)).toEqual([]);
  });
});

describe("the message", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  it.each([
    ["docs/spec/errors.md"],
    ["docs/ja/spec/errors.md"],
  ])("is the one %s documents", (file) => {
    const md = readFileSync(path.join(here, "..", "..", "..", file), "utf8");
    const section = md.slice(md.indexOf("### E0128"));
    // A double-backtick code span drops the space that pads it.
    const quoted = /^> ``(.*)``$/m.exec(section)?.[1]?.trim();
    expect(quoted?.replace("<builtin>", "column")).toBe(message("column"));
  });
});

const armProgram = (home: string) => `tile Home = ${home}
tile Header = text("h")
slot total : Int = 1
slot c : Bool = true
slot xs : List(Int) = [1, 2]
type Shape = Circle | Square
slot shape : Shape = Circle
slot pick : Option(Int) = None
fn greeting() -> Text = "hi"
app R
    caps   = []
    routes = {"/" -> Home, "/404" -> Home}
    init   = []
`;

const located = (src: string) =>
  checkSource(src).map((e) => `${e.code} ${e.pos.line}:${e.pos.col} ${e.message}`);

const armDiagnostics = (home: string) => located(armProgram(home));

// `tile Home = ` is 12 columns wide on line 1.
const armAt = (home: string, at: string) => `1:${13 + home.indexOf(at)}`;

const placed = (place: string) =>
  `A value is not a tile: ${place} has to be a tile. Show the value with a tile — \`text(…)\``;

const uncalled = (name: string, builtin: string) =>
  `\`${name}\` is a builtin tile named without its call: ${builtin} renders a positional ` +
  `argument only when it is a tile, so this one renders nothing. Call it — \`${name}()\``;

describe("a value written as an arm or a tile body", () => {
  it.each([
    ["a slot in a when", "column(when(c, total))", "total", "a `when` arm"],
    ["a fn call in a when", "column(when(c, greeting()))", "greeting", "a `when` arm"],
    ["a loop variable in a when", "column(for x in xs when(c, x))", "x))", "a `when` arm"],
    ["a builtin call in a when", `column(when(c, fmt("{0}", total)))`, "fmt", "a `when` arm"],
    ["an input the tile does not declare", "column(when(c, $1))", "$1", "a `when` arm"],
    ["a slot in an if", "column(if c then total else Header)", "total", "an `if` arm"],
    ["a fn call in an if", "column(if c then Header else greeting())", "greeting", "an `if` arm"],
    [
      "a loop variable in an if",
      "column(for x in xs if c then Header else x)",
      "x)",
      "an `if` arm",
    ],
    [
      "a slot in a match",
      "match shape with | Circle -> total | Square -> Header",
      "total",
      "a `match` arm",
    ],
    [
      "a fn call in a match",
      "column(match shape with | Circle -> Header | Square -> greeting())",
      "greeting",
      "a `match` arm",
    ],
    [
      "a loop variable in a match",
      "column(for x in xs match shape with | Circle -> x | Square -> Header)",
      "x |",
      "a `match` arm",
    ],
    [
      "a match binding in a match",
      "match pick with | Some(v) -> v | None -> Header",
      "v |",
      "a `match` arm",
    ],
    ["a slot in a for", "column(for x in xs total)", "total", "a `for` arm"],
    ["a fn call in a for", "column(for x in xs greeting())", "greeting", "a `for` arm"],
    ["a loop variable in a for", "column(for x in xs x)", "x)", "a `for` arm"],
    ["a slot as a tile body", "total", "total", "a tile's body"],
    ["a fn call as a tile body", "greeting()", "greeting", "a tile's body"],
  ])("is E0128 at the value: %s", (_, home, at, place) => {
    expect(armDiagnostics(home)).toEqual([`E0128 ${armAt(home, at)} ${placed(place)}`]);
  });

  it("is E0128 at a value written as a tile-test's expect", () => {
    const src = `${armProgram("Header")}test t = tile-test Header given={slots:{}} expect=total\n`;
    const line = src.split("\n").length - 1;
    expect(located(src)).toEqual([`E0128 ${line}:51 ${placed("a tile-test's `expect`")}`]);
  });

  it("checks nothing written on the value", () => {
    const home = `column(when(c, greeting(nope)), if c then Header else total {id: nope})`;
    expect(armDiagnostics(home)).toEqual([
      `E0128 ${armAt(home, "greeting")} ${placed("a `when` arm")}`,
      `E0128 ${armAt(home, "total")} ${placed("an `if` arm")}`,
    ]);
  });
});

describe("a name that is neither a tile nor a value", () => {
  it.each([
    ["a misspelt tile in a when", "column(when(c, Hedaer))", "Hedaer"],
    ["a lower-cased name in a when", "column(when(c, totl))", "totl"],
    ["a call in a when", "column(when(c, greting()))", "greting"],
    ["a tile body", "Hedaer", "Hedaer"],
    ["a lower-cased name in a container", 'column(text("a"), totl)', "totl"],
  ])("is E0105 at the name: %s", (_, home, name) => {
    expect(armDiagnostics(home)).toEqual([
      `E0105 ${armAt(home, name)} Reference to undefined tile "${name}"`,
    ]);
  });

  it("is a value when it is called in a container, which reads a call as a fn's", () => {
    const home = "column(greting())";
    expect(armDiagnostics(home)).toEqual([`E0128 ${armAt(home, "greting")} ${message("column")}`]);
  });
});

describe("a builtin tile named without its call", () => {
  it.each([
    ["in a column", "column(divider)", "divider", "column"],
    ["beside a sibling in a row", `row(text("a"), spinner)`, "spinner", "row"],
  ])("is E0128 naming the call: %s", (_, home, name, builtin) => {
    expect(armDiagnostics(home)).toEqual([`E0128 ${armAt(home, name)} ${uncalled(name, builtin)}`]);
  });

  it("is the value a loop variable of that name holds", () => {
    const home = "column(for spinner in xs row(spinner))";
    expect(armDiagnostics(home)).toEqual([`E0128 ${armAt(home, "spinner))")} ${message("row")}`]);
  });

  it("is a call of it in an arm, which reads a name as a tile call", () => {
    expect(armDiagnostics("column(when(c, divider), if c then spinner else Header)")).toEqual([]);
  });
});
