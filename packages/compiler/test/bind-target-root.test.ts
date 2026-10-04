// A `bind=` target's root has to be a slot where the target is written
// (forms.md §5.1): the control writes back to the slot the root names, and a
// name that is not one — a local, or a name the runtime provides — has no
// slot behind it. A literal or any other expression names no place at all.
// Each is E0229 at the target, saying what the root is where the checker
// knows it. A root another code already reports — a name that resolves to
// nothing (E0103), a `fn` (E0127) — is reported there alone.

import { BUILTIN_TILES, check, codegen, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

const HEAD = `type D = {title: Text}
slot title : Text = "t"
slot xs : List(Text) = ["a"]
slot grid : List(List(Text)) = [["a"]]
slot sel : Option(Text) = Some("s")
slot d : Option(D) = Some({title: "a"})
fn ident(t: Text) -> Text = t
`;
const APP = `
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

const diagnostics = (defs: string) => check(parse(lex(`${HEAD}${defs}${APP}`)));
const e0229 = (defs: string) => diagnostics(defs).filter((d) => d.code === "E0229");
const codes = (defs: string) => diagnostics(defs).map((d) => d.code);

/** What E0229 says the root is: the text between "cannot write to " and " —". */
const said = (defs: string): string[] =>
  e0229(defs).map((d) => d.message.replace(/^.*?cannot write to (.*?) — .*$/, "$1"));

describe("what E0229 says the root is", () => {
  it.each([
    [
      "a for variable that hides a slot of its name",
      "tile App = column(for title in xs input(bind=title))",
      `"title": it is the variable of a for, not a slot`,
    ],
    [
      "a for variable reached through an index step",
      "tile App = column(for r in grid input(bind=r[0]))",
      `"r": it is the variable of a for, not a slot`,
    ],
    [
      "a name a match arm binds",
      'tile App = match sel with\n  | Some(s) -> input(bind=s)\n  | None -> text("none")',
      `"s": it is a local name, not a slot`,
    ],
    [
      "an error-boundary fallback's $1",
      `tile Fb in=PanicInfo = input(bind=$1.message)
tile App error-boundary = Fb = column(text("x"))`,
      `"$1": it is this tile's input, not a slot`,
    ],
    [
      "the route",
      "tile App = column(input(bind=route.path))",
      `"route": it is a name the runtime provides, not a slot`,
    ],
    [
      "a text literal that names no slot",
      `tile App = column(input(bind="nope"))`,
      `the text literal "nope": a literal is a value, not a slot`,
    ],
    [
      "a number literal",
      "tile App = column(slider(bind=3))",
      "the literal 3: a literal is a value, not a slot",
    ],
    [
      "a call",
      "tile App = column(input(bind=ident(title)))",
      "this expression: it computes a value, not a slot",
    ],
    [
      "an operator",
      `tile App = column(input(bind=title + "x"))`,
      "this expression: it computes a value, not a slot",
    ],
  ])("%s", (_label, defs, what) => {
    expect(said(defs)).toEqual([what]);
  });

  it("gives the fix that goes with the root", () => {
    const [named] = e0229(`tile App = column(input(bind="title"))`);
    expect(named?.message).toContain("Write the slot's name without quotes: bind=title");
    const [nameless] = e0229(`tile App = column(input(bind="nope"))`);
    expect(nameless?.message).not.toContain("without quotes");
    expect(nameless?.message).toContain("Bind a slot");
  });
});

describe("a root another code reports", () => {
  it.each([
    ["a name that resolves to nothing", "input(bind=nope.title)", ["E0103"]],
    ["a fn named as a value", "input(bind=ident)", ["E0127"]],
    ["a call step on a slot", "input(bind=d.get().title)", ["E0602"]],
  ])("is not E0229 as well: %s", (_label, call, expected) => {
    expect(codes(`tile App = column(${call})`)).toEqual(expected);
  });
});

describe("the controls the root is asked of", () => {
  // Found from the lowering rather than from a list: a builtin lowers a bind
  // when its output carries the slot the target names.
  const lowersBind = (name: string): boolean => {
    const src = `${HEAD}tile App = column(${name}(bind=title, value="v"))${APP}`;
    const { js } = codegen(parse(lex(src)), { runtimeSpecifier: "./runtime.js" });
    return js.includes(`bind: "title"`);
  };
  const lowering = [...BUILTIN_TILES].filter(lowersBind).sort();

  it("are the builtins that lower a bind", () => {
    const asked = [...BUILTIN_TILES]
      .filter(
        (name) => e0229(`tile App = column(for x in xs ${name}(bind=x, value="v"))`).length > 0,
      )
      .sort();
    expect(lowering.length).toBeGreaterThan(0);
    expect(asked).toEqual(lowering);
  });
});
