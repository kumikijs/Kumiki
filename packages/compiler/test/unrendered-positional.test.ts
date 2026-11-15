import { BUILTIN_TILES } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { shownInPlaceOfPositional } from "../src/builtins.ts";
import { checkSource } from "./helpers/diagnostics.ts";

const program = (home: string) => `tile Header = text("header")
tile Card in={label: Text} = text($1.label)
tile Home = ${home}
slot n : Int = 0
type Mode = A | B
slot m : Mode = A
slot xs : List(Int) = [1]
app R
    caps   = []
    routes = {"/" -> Home, "/404" -> Home}
    init   = []
`;

const located = (src: string) =>
  checkSource(src).map((e) => `${e.code} ${e.pos.line}:${e.pos.col} ${e.message}`);

const diagnostics = (home: string) => located(program(home));

// `tile Home = ` is 12 columns wide on line 3.
const at = (home: string, arg: string) => `3:${13 + home.indexOf(arg)}`;

const shows = (builtin: string, args: string) =>
  `${builtin} renders no positional argument, so this one is never rendered. ` +
  `Write it as ${args}, or show it beside the ${builtin}`;

const showsNothing = (builtin: string) =>
  `${builtin} renders no positional argument, so this one is never rendered. ` +
  `Show it beside the ${builtin}`;

describe("a positional argument on a builtin that renders none", () => {
  it("is E0129 at each one, naming what the builtin shows", () => {
    const src = `tile Header = text("header")
tile P = column(button(Header, text="Go"), progress(text("a")), text("end"))
app M
    caps   = []
    routes = {"/" -> P, "/404" -> P}
    init   = []
`;
    expect(located(src)).toEqual([
      `E0129 2:24 ${shows("button", "`text=`")}`,
      `E0129 2:53 ${shows("progress", "`value=` or `max=`")}`,
    ]);
  });

  it("is E0129 for a value as well, which a tile would not show either", () => {
    const home = `column(button("Go", text="x"))`;
    expect(diagnostics(home)).toEqual([`E0129 ${at(home, '"Go"')} ${shows("button", "`text=`")}`]);
  });

  // The third column is what the builtin needs beside the tile for E0129 to be its only report.
  it.each([
    ["button", shows("button", "`text=`"), ""],
    ["toast", shows("toast", "`text=`"), ""],
    ["video", shows("video", "`src=`"), ""],
    ["progress", shows("progress", "`value=` or `max=`"), ""],
    ["input", shows("input", "`bind=`, `value=` or `placeholder=`"), ""],
    ["textarea", shows("textarea", "`bind=`, `value=` or `placeholder=`"), ""],
    ["select", shows("select", "`options=`, `bind=`, `value=` or `placeholder=`"), ""],
    ["check", shows("check", "`label=`, `bind=` or `value=`"), ""],
    ["switch", shows("switch", "`bind=` or `value=`"), ""],
    ["radio", shows("radio", "`label=`, `bind=` or `selected=`"), ""],
    ["slider", shows("slider", "`bind=` or `value=`"), ""],
    ["error", shows("error", "`field=`"), ", field=n"],
    ["divider", showsNothing("divider"), ""],
    ["spinner", showsNothing("spinner"), ""],
    ["skeleton", showsNothing("skeleton"), ""],
    ["route-outlet", showsNothing("route-outlet"), ""],
  ])("a tile in %s is E0129 at the tile", (builtin, message, needs) => {
    const home = `column(${builtin}(text("a")${needs}))`;
    expect(diagnostics(home)).toEqual([`E0129 ${at(home, 'text("a")')} ${message}`]);
  });

  it.each([
    ["image", shows("image", "`src=`")],
    ["icon", shows("icon", "`name=`")],
  ])("a value in %s, a value builtin that reads none, is the same E0129", (builtin, message) => {
    const home = `column(${builtin}("a"))`;
    expect(diagnostics(home)).toEqual([`E0129 ${at(home, '"a"')} ${message}`]);
  });

  it.each([
    ["image", "nope", `src="a.png"`, shows("image", "`src=`")],
    ["image", `row(text("a"), gap=2)`, `src="a.png"`, shows("image", "`src=`")],
    ["icon", "Header", `name="home"`, shows("icon", "`name=`")],
    ["icon", `icon(name="plus")`, `name="home"`, shows("icon", "`name=`")],
  ])("%s(%s, …) is E0129 alone", (builtin, arg, named, message) => {
    const home = `column(${builtin}(${arg}, ${named}))`;
    expect(diagnostics(home)).toEqual([`E0129 ${at(home, `${arg}, `)} ${message}`]);
  });

  // These parse only where a positional argument is read as a tile, so a parse error there
  // would hide every other diagnostic in the file.
  it.each([
    [`button(icon(name="plus"), text="Add")`, `icon(`, shows("button", "`text=`")],
    [
      `progress(row(text("a"), gap="md"), value=1)`,
      "row(",
      shows("progress", "`value=` or `max=`"),
    ],
    [`button(Header {pad: "md"}, text="Go")`, "Header", shows("button", "`text=`")],
    [
      `spinner(if n > 0 then card(text("a")) {pad: "md"} else text("b"))`,
      "if ",
      showsNothing("spinner"),
    ],
  ])("%s is E0129, not a parse error", (call, arg, message) => {
    const home = `column(${call}, text("end"))`;
    expect(diagnostics(home)).toEqual([`E0129 ${at(home, arg)} ${message}`]);
  });

  // Under a `let` a tile call reads as a `fn` call and would be reported wrongly, so a diagnostic
  // inside the argument waits until it is moved.
  it.each([
    ["a tile the program defines", "Header"],
    ["a user tile's call", `Card({label: "a"})`],
    ["a when", "when(n > 0, Header)"],
    ["an if", `if n > 0 then Header else text("b")`],
    ["a match", `match m with | A -> Header | B -> text("b")`],
    ["a for", "for x in xs Header"],
    ["a builtin's call with a named argument", `icon(name="plus")`],
    ["a container's call with a named argument", `row(text("a"), gap=2)`],
    ["a tile with a props block", `Header {pad: "md"}`],
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
    expect(
      checkSource(program(`column(button(Header, text="Go"))`)).map((e) => e.unrendered),
    ).toEqual(["positional"]);
  });

  // What each builtin needs beside the named argument for the call to check clean.
  const needs: Record<string, string> = { error: ", field=n", radio: ", value=m" };
  const written: Record<string, string> = {
    text: `"Go"`,
    src: `"a.png"`,
    name: `"home"`,
    label: `"Remember me"`,
    placeholder: `"Name"`,
    options: `[{label: "A", value: "a"}]`,
    selected: "true",
    max: "2",
    field: "n",
  };
  // `bind=` and `value=` take the type of what the builtin edits.
  const typed: Record<string, Record<string, string>> = {
    bind: {
      input: "s",
      textarea: "s",
      select: "s",
      check: "agreed",
      switch: "agreed",
      radio: "m",
      slider: "f",
    },
    value: {
      input: `"a"`,
      textarea: `"a"`,
      select: `"a"`,
      check: "true",
      switch: "true",
      slider: "1",
      progress: "1",
    },
  };
  const suggested = [...BUILTIN_TILES].flatMap((builtin) =>
    (shownInPlaceOfPositional(builtin) ?? []).map((arg) => [builtin, arg] as const),
  );
  it.each(suggested)("%s checks clean written with the suggested %s=", (builtin, arg) => {
    const value = typed[arg]?.[builtin] ?? written[arg];
    expect(value, `a value for ${builtin}(${arg}=…)`).toBeDefined();
    const src = `slot s : Text = ""
slot agreed : Bool = false
slot f : Float = 0
slot n : Text = ""
type Mode = A | B
slot m : Mode = A
tile Home = column(${builtin}(${arg}=${value}${arg === "field" ? "" : (needs[builtin] ?? "")}))
app R
    caps   = []
    routes = {"/" -> Home, "/404" -> Home}
    init   = []
`;
    expect(located(src)).toEqual([]);
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
