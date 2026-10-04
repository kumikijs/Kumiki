// Which tile arguments are tiles and which are values (language.md §1.7.1,
// §1.7.3).
//
// `tile-arg ::= (identifier '=')? expr`: an argument is an expression. The one
// argument that renders as a tile is a positional argument of a builtin that
// renders it as a child — `column`, `row`, `box`, … (`positionalIsTile`) — so
// an `if` / `match` / call / capitalised name is a tile there. Everywhere else
// a value belongs: every named argument, a value builtin's content, and a user
// tile's positional argument, which is its `in=` input. §1.7.3 adds one shape:
// a capitalised name written as an event handler of a builtin that takes tiles
// is a tile call.
//
// This file pins the shapes the parser gives; what the built app renders for
// the same arguments is pinned in `packages/tests/tile-arg-values.test.ts`.

import { check, type Expr, lex, parse, type TileExpr } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { tileCall } from "./helpers/ast.ts";

const HOST = `type F = All | Done
type C = Red | Blue
slot busy : Bool = false
slot filter : F = All
slot s : Text = "5"
slot v : Int = 0
slot c : C = Red
fn label(t: Text) -> Text = t + "!"
reducer Bump on=app.start do= v := v + 1
tile Row in=Int = text("n=" + $1.show)
tile Tab in=F = text("tab")
tile Say in=Text = text($1)
tile Btn = button(text="b")
tile A = text("a")
tile B = text("b")
`;

const program = (tile: string) => `${HOST}tile T = ${tile}
app P
    caps   = []
    routes = {"/" -> T, "/404" -> T}
    init   = []
`;

/**
 * The value of one argument of `tile`'s outermost call: the named argument
 * `at`, or the positional argument at index `at`.
 */
function argOf(tile: string, at: string | number): Expr | TileExpr {
  const def = parse(lex(program(tile))).defs.find((d) => d.kind === "TileDef" && d.name === "T");
  if (def?.kind !== "TileDef") throw new Error("fixture has no tile T");
  const args = tileCall(def.body).args;
  const arg =
    typeof at === "string"
      ? args.find((a) => a.name === at)
      : args.filter((a) => a.name === undefined)[at];
  if (!arg) throw new Error(`${tile} has no argument ${at}`);
  return arg.value;
}

/** `kind`, with the name a tile call or a variant tag carries. */
function shapeOf(v: Expr | TileExpr): string {
  if (v.kind === "TileCall" || v.kind === "Variant") return `${v.kind} ${v.name}`;
  return v.kind;
}

const errorsOf = (tile: string) =>
  check(parse(lex(program(tile))))
    .filter((e) => e.severity !== "warning")
    .map((e) => `${e.code} ${e.message}`);

describe("a named argument is a value", () => {
  it.each([
    ['button(text="Save", disabled=if busy then true else false)', "disabled", "IfExpr"],
    ['box(text("tab"), class=if busy then "tab on" else "tab")', "class", "IfExpr"],
    ["progress(value=3, max=if busy then 10 else 20)", "max", "IfExpr"],
    [
      'button(text="x", disabled=match c with | Red -> true | Blue -> false)',
      "disabled",
      "MatchExpr",
    ],
    ['radio(group="f", value="all", selected=All == filter)', "selected", "BinOp"],
    ["slider(bind=v, max=Int.parse(s).get-or(10))", "max", "MethodCall"],
    // A call named like a builtin tile is a call: `label` is the program's fn.
    ['box(text("x"), class=label("y"))', "class", "Call"],
    // On a user tile, a named argument is a prop, and a prop is a value.
    ['Btn(hint=if busy then "a" else "b")', "hint", "IfExpr"],
  ])("%s — %s is %s", (tile, at, shape) => {
    expect(shapeOf(argOf(tile, at))).toBe(shape);
    expect(errorsOf(tile)).toEqual([]);
  });
});

describe("a capitalised name written as an event handler (§1.7.3)", () => {
  it.each([
    ["box(onClick=Bump)", "onClick"],
    ["button(onClick=Bump)", "onClick"],
    ["check(bind=busy, onChange=Bump)", "onChange"],
    ["slider(bind=v, onChange=Bump)", "onChange"],
    ["column(onClick=Bump)", "onClick"],
  ])("is a tile call on a builtin that takes tiles: %s", (tile, at) => {
    expect(shapeOf(argOf(tile, at))).toBe("TileCall Bump");
  });

  // The call and brace forms are the same tile call as the bare name.
  it.each([
    ["button(onClick=Bump())", "onClick"],
    ["button(onClick=Bump {})", "onClick"],
    ["check(bind=busy, onChange=Bump {})", "onChange"],
    ['radio(group="f", value="all", onChange=Bump {})', "onChange"],
  ])("%s is a tile call", (tile, at) => {
    const v = argOf(tile, at);
    expect(shapeOf(v)).toBe("TileCall Bump");
    expect(v.kind === "TileCall" && [v.args.length, v.props.length]).toEqual([0, 0]);
    expect(errorsOf(tile)).toEqual([]);
  });

  it.each([
    ['link(to="/", onClick=Bump)', "onClick"],
    ["Btn(onClick=Bump)", "onClick"],
  ])("is a variant tag on a value builtin or a user tile: %s", (tile, at) => {
    expect(shapeOf(argOf(tile, at))).toBe("Variant Bump");
  });

  // Any other named argument is a value, on a builtin that takes tiles too.
  it.each([
    ['button(text="x", value=All)', "value", "Variant All"],
    ['box(text("x"), header=All)', "header", "Variant All"],
    ['radio(group="f", value=All)', "value", "Variant All"],
    ['button(text="x", disabled=All == filter)', "disabled", "BinOp"],
    ["input(bind=s, value=Int.parse(s).get-or(0).show)", "value", "FieldAccess"],
  ])("is a value as any other named argument: %s — %s is %s", (tile, at, shape) => {
    expect(shapeOf(argOf(tile, at))).toBe(shape);
  });
});

describe("a user tile's positional argument is its input, a value", () => {
  it.each([
    ["Row(if busy then 100 else 1)", "IfExpr"],
    ["Row(match c with | Red -> 100 | Blue -> 1)", "MatchExpr"],
    ["Tab(if busy then Done else All)", "IfExpr"],
    ["Tab(Done)", "Variant Done"],
    ['Say(label("x"))', "Call"],
  ])("%s is %s", (tile, shape) => {
    expect(shapeOf(argOf(tile, 0))).toBe(shape);
    expect(errorsOf(tile)).toEqual([]);
  });
});

describe("a positional argument of a builtin that renders it as a child is a tile", () => {
  it.each([
    ["column(if busy then A() else B())", "TileIf"],
    ["column(match c with | Red -> A | Blue -> spinner())", "TileMatch"],
    ["box(Btn)", "TileCall Btn"],
    ['column(text("a"))', "TileCall text"],
    ["column(for x in [1, 2] text(x.show))", "TileFor"],
  ])("%s is %s", (tile, shape) => {
    expect(shapeOf(argOf(tile, 0))).toBe(shape);
    expect(errorsOf(tile)).toEqual([]);
  });

  it("leaves a value builtin's content a value", () => {
    expect(shapeOf(argOf('text(if busy then "a" else "b")', 0))).toBe("IfExpr");
    expect(shapeOf(argOf('heading(label("x"))', 0))).toBe("Call");
  });
});
