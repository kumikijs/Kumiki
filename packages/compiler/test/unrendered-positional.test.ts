// A builtin that renders no positional argument — `button`, `progress`,
// `input`, … — refuses one, tile or value, with E0129 naming the arguments it
// does show (language.md §1.7.1). A container renders its positional
// arguments as children, so a tile there renders and a value there is E0128
// (`value-as-child.test.ts`).
//
// What the mounted app renders for the same programs is pinned in
// `packages/tests/unrendered-positional.test.ts`, and the set of builtins
// that render their positional arguments is held against codegen in
// `builtin-tiles.test.ts`.

import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { check, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

const program = (home: string) => `tile Header = text("header")
tile Card in={label: Text} = text($1.label)
tile Home = ${home}
slot n : Int = 0
app R
    caps   = []
    routes = {"/" -> Home, "/404" -> Home}
    init   = []
`;

const errorsOf = (home: string) => check(parse(lex(program(home))));

const diagnostics = (home: string) =>
  errorsOf(home).map((e) => `${e.code} ${e.pos.line}:${e.pos.col} ${e.message}`);

// `tile Home = ` is 12 columns wide on line 3; `at` is a substring of the body
// that starts where the argument does.
const at = (home: string, arg: string) => `3:${13 + home.indexOf(arg)}`;

const shows = (builtin: string, args: string) =>
  `${builtin} renders no positional argument, so this one is never rendered. ` +
  `Write it as ${args}, or show it beside the ${builtin}`;

const showsNothing = (builtin: string) =>
  `${builtin} renders no positional argument, so this one is never rendered. ` +
  `Show it beside the ${builtin}`;

describe("a positional argument on a builtin that renders none", () => {
  it("is E0129 at each one in the issue's program, naming what the builtin shows", () => {
    const src = `tile Header = text("header")
tile P = column(button(Header, text="Go"), progress(text("a")), text("end"))
app M
    caps   = []
    routes = {"/" -> P, "/404" -> P}
    init   = []
`;
    expect(
      check(parse(lex(src))).map((e) => `${e.code} ${e.pos.line}:${e.pos.col} ${e.message}`),
    ).toEqual([
      `E0129 2:24 ${shows("button", "`text=`")}`,
      `E0129 2:53 ${shows("progress", "`value=` or `max=`")}`,
    ]);
  });

  it("is E0129 for a value as well, which a tile would not show either", () => {
    const home = `column(button("Go", text="x"))`;
    expect(diagnostics(home)).toEqual([`E0129 ${at(home, '"Go"')} ${shows("button", "`text=`")}`]);
  });

  // Every builtin the runtime renders no positional argument of, whatever it
  // is given: a tile there is refused as a value is.
  it.each([
    ["button", shows("button", "`text=`")],
    ["toast", shows("toast", "`text=`")],
    ["video", shows("video", "`src=`")],
    ["progress", shows("progress", "`value=` or `max=`")],
    ["input", shows("input", "`bind=`, `value=` or `placeholder=`")],
    ["textarea", shows("textarea", "`bind=`, `value=` or `placeholder=`")],
    ["select", shows("select", "`options=`, `bind=`, `value=` or `placeholder=`")],
    ["check", shows("check", "`bind=` or `value=`")],
    ["switch", shows("switch", "`bind=` or `value=`")],
    ["radio", shows("radio", "`bind=` or `selected=`")],
    ["slider", shows("slider", "`bind=`")],
    ["error", shows("error", "`field=`")],
    ["divider", showsNothing("divider")],
    ["spinner", showsNothing("spinner")],
    ["skeleton", showsNothing("skeleton")],
    ["route-outlet", showsNothing("route-outlet")],
  ])("a tile in %s is E0129 at the tile", (builtin, message) => {
    const home = `column(${builtin}(text("a")))`;
    expect(diagnostics(home)).toEqual([`E0129 ${at(home, 'text("a")')} ${message}`]);
  });

  it.each([
    ["image", shows("image", "`src=`")],
    ["icon", shows("icon", "`name=`")],
  ])("a value in %s, a value builtin that reads none, is the same E0129", (builtin, message) => {
    const home = `column(${builtin}("a"))`;
    expect(diagnostics(home)).toEqual([`E0129 ${at(home, '"a"')} ${message}`]);
  });

  // The argument is moved or removed whole, as a value in a container is
  // (E0128), so a diagnostic inside it waits until it is: under a `let` a
  // tile call reads as a `fn` call and would be reported wrongly.
  it.each([
    ["a tile the program defines", "Header"],
    ["a user tile's call", `Card({label: "a"})`],
    ["a when", "when(n > 0, Header)"],
    ["a slot", "n"],
    ["a member read", "n.show"],
    ["a literal", "42"],
    ["a builtin named without its call", "divider"],
    ["a let around a tile", "let x = 1 in Card(x)"],
    ["a misspelt tile", "Hedaer"],
    ["a misspelt name", "nn"],
  ])("is E0129 alone for %s", (_, arg) => {
    const home = `column(button(${arg}, text="Go"))`;
    expect(diagnostics(home)).toEqual([
      `E0129 ${at(home, `${arg}, `)} ${shows("button", "`text=`")}`,
    ]);
  });

  it("is reported at every positional argument", () => {
    const home = `column(progress(Header, text("a"), value=1))`;
    expect(diagnostics(home)).toEqual([
      `E0129 ${at(home, "Header")} ${shows("progress", "`value=` or `max=`")}`,
      `E0129 ${at(home, 'text("a")')} ${shows("progress", "`value=` or `max=`")}`,
    ]);
  });

  it("says it is the positional shape, which `kumiki fix` leaves to the author", () => {
    expect(errorsOf(`column(button(Header, text="Go"))`).map((e) => e.unrendered)).toEqual([
      "positional",
    ]);
  });

  it("is not reported for the arguments the builtin reads", () => {
    expect(
      diagnostics(
        `column(button(text="Go"), progress(value=1, max=2), toast(text="t"), spinner(), divider())`,
      ),
    ).toEqual([]);
  });
});

describe("a builtin that renders its positional arguments as children", () => {
  it.each([
    "column(Header)",
    "card(Header)",
    `row(Header, text("a"))`,
    "box(Header)",
    "page(Header)",
    "grid(Header)",
    "stack(Header)",
    "overlay(Header)",
    "panel(Header)",
    "region(Header)",
    "scroll(Header)",
    "fieldset(Header)",
    "form(Header)",
    "list(list-item(Header))",
    "table(table-head(table-row(table-cell(Header))), table-body(table-row(table-cell(Header))))",
    `modal(Header, title="m")`,
    `drawer(Header, side="left")`,
    "popover(Header)",
    `details(Header, summary="more")`,
    `tooltip(button(text="Go"), text="tip")`,
  ])("accepts a tile: %s", (home) => {
    expect(diagnostics(home)).toEqual([]);
  });

  it("keeps E0128 and its text(…) advice for a value", () => {
    const home = "card(42)";
    expect(diagnostics(home)).toEqual([
      `E0128 ${at(home, "42")} A value is not a tile: card renders a positional argument only when it is a tile, so this one renders nothing. Show the value with a tile — \`text(…)\` — or, for a \`let\`, write the value where it is used or compute it in a \`fn\``,
    ]);
  });
});

describe("the messages", () => {
  // The forms after the first two quotes in errors.md's E0129, in order.
  const here = path.dirname(fileURLToPath(import.meta.url));
  it.each([
    ["docs/spec/errors.md"],
    ["docs/ja/spec/errors.md"],
  ])("are the ones %s documents", (file) => {
    const md = readFileSync(path.join(here, "..", "..", "..", file), "utf8");
    const section = md.slice(md.indexOf("### E0129"), md.indexOf("## E02xx"));
    const quoted = [...section.matchAll(/^> ``(.*)``$/gm)].map((m) => m[1]?.trim());
    expect(quoted.slice(1, 3)).toEqual([shows("<builtin>", "<args>"), showsNothing("<builtin>")]);
  });
});
