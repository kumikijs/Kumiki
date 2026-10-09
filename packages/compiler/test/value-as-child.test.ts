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
