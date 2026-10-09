// A positional argument of a builtin that is not a value builtin renders only
// when it is a tile: a tile call, `match` / control flow, or the name of a tile
// the program defines (language.md §1.7.1). Codegen drops any other value
// there, so `column(text("a"), 42)` and `column(let x = 42 in Card(x))` passed
// `check` and rendered as if the value were not written — and a slot named
// there, `column(n)`, put a `null` into the child list. It is E0128 at the
// value, and nothing inside it is checked: under a `let` a tile call reads as
// a `fn` call and would be reported wrongly, so a correct diagnostic in there
// (an undefined name, say) is not reported either until the value is moved.
//
// This file pins what `check` says; what the built app renders for the same
// programs is pinned in `packages/tests/value-as-child.test.ts`.

import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { check, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

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
  check(parse(lex(program(home)))).map((e) => `${e.code} ${e.pos.line}:${e.pos.col} ${e.message}`);

const codes = (home: string) => check(parse(lex(program(home)))).map((e) => e.code);

const message = (builtin: string) =>
  `A value is not a tile: ${builtin} renders a positional argument only when it is a tile, so this one renders nothing. Show the value with a tile — \`text(…)\` — or, for a \`let\`, write the value where it is used or compute it in a \`fn\``;

// `tile Home = ` is 12 columns wide on line 2, so a value's column is 13 plus
// its offset in the body.
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
    // `row` renders children; `button` reads no positional argument at all.
    // A value is dropped by either.
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

// The name of a tile the program defines renders as that tile in a child
// position, so it is that tile there and not a value: it is not E0128, and it
// is not looked up as a value name, where a `fn` that shares it would be one
// named without its call. A value position still reads the `fn`.
describe("the name of a tile in a child position is the tile", () => {
  it("with no other definition of the name", () => {
    expect(diagnostics("column(lower)")).toEqual([]);
  });

  it("beside a fn of the same name, which a value position still reads", () => {
    const src = `fn lower() -> Text = "f"\n${program("column(lower, text(lower))")}`;
    // `tile Home = ` on line 3 is 12 columns wide; `text(lower)` reads the fn.
    expect(check(parse(lex(src))).map((e) => `${e.code} ${e.pos.line}:${e.pos.col}`)).toEqual([
      "E0127 3:32",
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
  // `inferType` had no `let` case, so the comparison was skipped as
  // undecidable and any value passed.
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
  // errors.md quotes it, and a message that drifts from the catalogue is a
  // diagnostic whose documentation answers a different question than the tool.
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
