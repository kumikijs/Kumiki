import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkSource, codesOf, pointedErrorsOf } from "./helpers/diagnostics.ts";

const program = (home: string) => `tile Card in={label: Text} = text($1.label)
tile Home = ${home}
tile lower = text("lower")
slot n : Int = 0
fn three() -> Int = 3
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
    ["a fn call", `column(text("a"), three())`, "three()"],
    ["a binary expression", `column(text("a"), n.show + "x")`, "n.show"],
    ["a slot, which lowered to a null child", `column(text("a"), n)`, "n)"],
  ])("is E0128 at the value: %s", (_, home, value) => {
    expect(diagnostics(home)).toEqual([E0128(home, value)]);
  });

  it.each([
    ["table-cell", `table-cell(n.show)`, "n.show"],
    ["list-item", `list-item(n)`, "n)"],
  ])("is E0128 at the value in a %s", (builtin, home, value) => {
    expect(diagnostics(home)).toEqual([E0128(home, value, builtin)]);
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

describe("the name of a tile in a child position is the tile", () => {
  it("with no other definition of the name", () => {
    expect(diagnostics("column(lower)")).toEqual([]);
  });

  it("beside a fn of the same name, which a value position still reads", () => {
    const src = `fn lower() -> Text = "f"\n${program("column(lower, text(lower))")}`;
    expect(checkSource(src).map((e) => `${e.code} ${e.pos.line}:${e.pos.col}`)).toEqual([
      "E0127 3:32",
    ]);
  });

  it.each([
    ["alone", ""],
    ["beside a slot of the same name", "slot needs : Int = 0\n"],
  ])("is E0213 for a tile that declares `in=`, %s", (_, extra) => {
    const src = `${extra}tile needs in=Int = text($1.show)\n${program("column(needs, Card)")}`;
    const at = extra === "" ? 3 : 4;
    expect(
      checkSource(src).map((e) => `${e.code} ${e.pos.line}:${e.pos.col} ${e.message}`),
    ).toEqual([
      `E0213 ${at}:20 Tile "needs" expects 1 argument(s) but got 0`,
      `E0213 ${at}:27 Tile "Card" expects 1 argument(s) but got 0`,
    ]);
  });
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
tile Item = text("i")
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

// Each error with the source text it points at, to the end of its line.
const armErrors = (home: string) => pointedErrorsOf(armProgram(home));

const placed = (place: string) =>
  `A value is not a tile: ${place} has to be a tile. Show the value with a tile — \`text(…)\``;

const uncalled = (name: string, builtin: string, { call = true } = {}) =>
  `\`${name}\` is a builtin tile named without its call: ${builtin} renders a positional ` +
  `argument only when it is a tile, so this one renders nothing.` +
  (call ? ` Call it — \`${name}()\`` : "");

describe("a value written as an arm or a tile body", () => {
  it.each([
    ["a slot in a when", "column(when(c, total))", "total))", "a `when` arm"],
    ["a fn call in a when", "column(when(c, greeting()))", "greeting()))", "a `when` arm"],
    ["a loop variable in a when", "column(for x in xs when(c, x))", "x))", "a `when` arm"],
    [
      "a builtin call in a when",
      `column(when(c, fmt("{0}", total)))`,
      `fmt("{0}", total)))`,
      "a `when` arm",
    ],
    ["an input the tile does not declare", "column(when(c, $1))", "$1))", "a `when` arm"],
    ["a slot in an if", "column(if c then total else Header)", "total else Header)", "an `if` arm"],
    [
      "a fn call in an if",
      "column(if c then Header else greeting())",
      "greeting())",
      "an `if` arm",
    ],
    [
      "a loop variable in an if",
      "column(for x in xs if c then Header else x)",
      "x)",
      "an `if` arm",
    ],
    [
      "a slot in a match",
      "match shape with | Circle -> total | Square -> Header",
      "total | Square -> Header",
      "a `match` arm",
    ],
    [
      "a fn call in a match",
      "column(match shape with | Circle -> Header | Square -> greeting())",
      "greeting())",
      "a `match` arm",
    ],
    [
      "a loop variable in a match",
      "column(for x in xs match shape with | Circle -> x | Square -> Header)",
      "x | Square -> Header)",
      "a `match` arm",
    ],
    [
      "a match binding in a match",
      "match pick with | Some(v) -> v | None -> Header",
      "v | None -> Header",
      "a `match` arm",
    ],
    ["a slot in a for", "column(for x in xs total)", "total)", "a `for` arm"],
    ["a fn call in a for", "column(for x in xs greeting())", "greeting())", "a `for` arm"],
    ["a loop variable in a for", "column(for x in xs x)", "x)", "a `for` arm"],
    ["a slot as a tile body", "total", "total", "a tile's body"],
    ["a fn call as a tile body", "greeting()", "greeting()", "a tile's body"],
  ])("is E0128 at the value: %s", (_, home, text, place) => {
    expect(armErrors(home)).toEqual([{ code: "E0128", message: placed(place), text }]);
  });

  it("is E0128 at a value written as a tile-test's expect", () => {
    const src = `${armProgram("Header")}test t = tile-test Header given={slots:{}} expect=total\n`;
    expect(pointedErrorsOf(src)).toEqual([
      { code: "E0128", message: placed("a tile-test's `expect`"), text: "total" },
    ]);
  });

  it("checks nothing written on the value", () => {
    const home = `column(when(c, greeting(nope)), if c then Header else total {id: nope})`;
    expect(armErrors(home)).toEqual([
      {
        code: "E0128",
        message: placed("a `when` arm"),
        text: "greeting(nope)), if c then Header else total {id: nope})",
      },
      { code: "E0128", message: placed("an `if` arm"), text: "total {id: nope})" },
    ]);
  });
});

describe("a name that is neither a tile nor a value", () => {
  it.each([
    ["a misspelt tile in a when", "column(when(c, Hedaer))", "Hedaer", "Hedaer))"],
    ["a lower-cased name in a when", "column(when(c, totl))", "totl", "totl))"],
    ["a call in a when", "column(when(c, greting()))", "greting", "greting()))"],
    ["a tile body", "Hedaer", "Hedaer", "Hedaer"],
    ["a lower-cased name in a container", 'column(text("a"), totl)', "totl", "totl)"],
  ])("is E0105 at the name: %s", (_, home, name, text) => {
    expect(armErrors(home)).toEqual([
      { code: "E0105", message: `Reference to undefined tile "${name}"`, text },
    ]);
  });

  it("is a value when it is called in a container, which reads a call as a fn's", () => {
    expect(armErrors("column(greting())")).toEqual([
      { code: "E0128", message: message("column"), text: "greting())" },
    ]);
  });
});

describe("a name read after the scope that declared it ended", () => {
  // The name is a value whose scope is over: E0103 says so, where E0105 would offer a tile.
  it.each([
    ["in a container", `column(for item in xs text("a"), item)`, "for-expr", "item)"],
    ["in an arm", `column(for item in xs text("a"), when(c, item))`, "for-expr", "item))"],
    [
      "in a sibling match arm",
      "match pick with | Some(v) -> Header | None -> v",
      "match-expr",
      "v",
    ],
  ])("is E0103 with the scope that ended: %s", (_, home, scope, text) => {
    const errors = checkSource(armProgram(home));
    expect(errors.map((e) => [e.code, e.endedScope])).toEqual([["E0103", scope]]);
    expect(armErrors(home).map((e) => e.text)).toEqual([text]);
  });
});

describe("a tile's name", () => {
  it("is a value in a container when a slot has it", () => {
    const src = `${armProgram("column(Big)")}slot Big : Int = 1\n`;
    expect(pointedErrorsOf(src)).toEqual([
      { code: "E0128", message: message("column"), text: "Big)" },
    ]);
  });

  it("stays the tile when a loop variable shadows it, as codegen renders it", () => {
    expect(codesOf(armProgram("column(for Item in xs Item)"))).toEqual([]);
  });
});

describe("a builtin tile named without its call", () => {
  it.each([
    ["in a column", "column(divider)", "divider", "column", "divider)"],
    ["beside a sibling in a row", `row(text("a"), spinner)`, "spinner", "row", "spinner)"],
  ])("is E0128 naming the call: %s", (_, home, name, builtin, text) => {
    expect(armErrors(home)).toEqual([{ code: "E0128", message: uncalled(name, builtin), text }]);
  });

  it("is not told to call it under a builtin that renders no positional argument", () => {
    // `button(text="x", divider())` checks clean and renders no divider either.
    expect(armErrors(`column(button(text="x", divider))`)).toEqual([
      { code: "E0128", message: uncalled("divider", "button", { call: false }), text: "divider))" },
    ]);
  });

  it("is the value a loop variable of that name holds", () => {
    expect(armErrors("column(for spinner in xs row(spinner))")).toEqual([
      { code: "E0128", message: message("row"), text: "spinner))" },
    ]);
  });

  it("is a call of it in an arm, which reads a name as a tile call", () => {
    expect(armErrors("column(when(c, divider), if c then spinner else Header)")).toEqual([]);
  });
});
