import { type Expr, lex, parse, type TileExpr } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { VALUE_BUILTIN_CONTENT } from "../src/builtins.ts";
import { HANDLER_NAMES } from "../src/ui-lifts.ts";
import { tileCall } from "./helpers/ast.ts";
import { codesOf, errorsOf, summariesOf } from "./helpers/diagnostics.ts";
import { withApp } from "./helpers/programs.ts";

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

const program = (tile: string) => withApp(`${HOST}tile App = ${tile}`);

/** The named argument `at`, or the positional argument at index `at`, of `tile`'s outermost call. */
function argOf(tile: string, at: string | number): Expr | TileExpr {
  const def = parse(lex(program(tile))).defs.find((d) => d.kind === "TileDef" && d.name === "App");
  if (def?.kind !== "TileDef") throw new Error("fixture has no tile App");
  const args = tileCall(def.body).args;
  const arg =
    typeof at === "string"
      ? args.find((a) => a.name === at)
      : args.filter((a) => a.name === undefined)[at];
  if (!arg) throw new Error(`${tile} has no argument ${at}`);
  return arg.value;
}

function shapeOf(v: Expr | TileExpr): string {
  if (v.kind === "TileCall" || v.kind === "Variant") return `${v.kind} ${v.name}`;
  return v.kind;
}

const summaries = (tile: string) => summariesOf(program(tile));

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
    // `label` is the program's fn, not the builtin tile.
    ['box(text("x"), class=label("y"))', "class", "Call"],
    ['Btn(hint=if busy then "a" else "b")', "hint", "IfExpr"],
    // A capitalised name is a variant tag in a named argument that is not a handler,
    // on a builtin whose positional argument is a tile too.
    ['button(text="x", value=All)', "value", "Variant All"],
    ['box(text("x"), header=All)', "header", "Variant All"],
    ['radio(group="f", value=All)', "value", "Variant All"],
    ['button(text="x", disabled=All == filter)', "disabled", "BinOp"],
    ["input(bind=s, value=Int.parse(s).get-or(0).show)", "value", "FieldAccess"],
  ])("%s — %s is %s", (tile, at, shape) => {
    expect(shapeOf(argOf(tile, at))).toBe(shape);
    expect(summaries(tile)).toEqual([]);
  });
});

describe("a capitalised name written as an event handler", () => {
  it.each([
    ["box(onClick=Bump)", "onClick"],
    ["button(onClick=Bump)", "onClick"],
    ["check(bind=busy, onChange=Bump)", "onChange"],
    ["slider(bind=v, onChange=Bump)", "onChange"],
    ["column(onClick=Bump)", "onClick"],
    ['image(src="a.png", onClick=Bump)', "onClick"],
    ['icon(name="home", onClick=Bump)', "onClick"],
  ])("is a tile call on a builtin that does not read its positional argument as content: %s", (tile, at) => {
    expect(shapeOf(argOf(tile, at))).toBe("TileCall Bump");
  });

  it.each([
    ["button(onClick=Bump())", "onClick"],
    ["button(onClick=Bump {})", "onClick"],
    ["check(bind=busy, onChange=Bump {})", "onChange"],
    ['radio(group="f", value="all", onChange=Bump {})', "onChange"],
  ])("%s is the same tile call as the bare name", (tile, at) => {
    const v = argOf(tile, at);
    expect(shapeOf(v)).toBe("TileCall Bump");
    expect(v.kind === "TileCall" && [v.args.length, v.props.length]).toEqual([0, 0]);
    expect(summaries(tile)).toEqual([]);
  });

  it.each([
    ['image(src="a.png", onClick=Bump())', "onClick"],
    ['icon(name="home", onClick=Bump {})', "onClick"],
  ])("%s parses as the same tile call as the bare name", (tile, at) => {
    const v = argOf(tile, at);
    expect(shapeOf(v)).toBe("TileCall Bump");
    expect(v.kind === "TileCall" && [v.args.length, v.props.length]).toEqual([0, 0]);
  });

  it.each([
    ['link(to="/", onClick=Bump)', "onClick"],
    ["Btn(onClick=Bump)", "onClick"],
  ])("is a variant tag on a value builtin that reads a positional argument, or a user tile: %s", (tile, at) => {
    expect(shapeOf(argOf(tile, at))).toBe("Variant Bump");
  });

  const otherTiles: readonly (readonly [string, (handler: string) => string])[] = [
    ...Object.entries(VALUE_BUILTIN_CONTENT)
      .filter(([, reading]) => reading.positional)
      .map(([name]) => [`the value builtin ${name}`, (h: string) => `${name}(${h})`] as const),
    ["a user tile", (h) => `Btn(${h})`],
    ["a user tile, beside its input", (h) => `Row(${h}, 1)`],
  ];

  describe.each(otherTiles)("on %s", (_, write) => {
    it.each(
      [...HANDLER_NAMES].flatMap((name) =>
        ["Bump()", "Bump {}", "Bump() {}"].map((form) => [name, form] as const),
      ),
    )("%s=%s is the same node as the bare name", (name, form) => {
      expect(argOf(write(`${name}=${form}`), name)).toEqual(argOf(write(`${name}=Bump`), name));
    });
  });

  it.each([
    ['link(to="/", onClick=Bump(1))', "Variant Bump"],
    ["Btn(onClick=Some(1))", "Variant Some"],
    ['link(to="/", onClick=Bump {x: 1})', "TileCall Bump"],
    ["Btn(onClick=Bump {x: 1})", "TileCall Bump"],
    ["Btn(onClick=Bump(1) {})", "TileCall Bump"],
    ["Btn(onClick=Bump((1)) {})", "TileCall Bump"],
  ])("carrying arguments or props, %s is %s", (tile, shape) => {
    expect(shapeOf(argOf(tile, "onClick"))).toBe(shape);
  });

  it.each([
    'link(to="/", onClick=Bump(1))',
    "Btn(onClick=Some(1))",
    'link(to="/", onClick=Bump {x: 1})',
    "Btn(onClick=Bump {x: 1})",
    "Btn(onClick=Bump(1) {})",
    "Btn(onClick=Bump((1)) {})",
    "Btn(onClick=Bump(1) + 1)",
    "Btn(onClick=Bump() == 1)",
    "Btn(onClick=Bump(1).x)",
    "Btn(onClick=when(busy, Bump))",
  ])("is reported once as no reducer name: %s", (tile) => {
    const col = "tile App = ".length + tile.indexOf("onClick=") + "onClick=".length + 1;
    expect(errorsOf(program(tile)).map((e) => `${e.code} ${e.pos.col} ${e.message}`)).toEqual([
      `E0201 ${col} Event handler arg "onClick" must be a reducer name`,
    ]);
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
    expect(summaries(tile)).toEqual([]);
  });
});

describe("a positional argument is a tile on a builtin that does not read it as content", () => {
  it.each([
    ["column(if busy then A() else B())", "TileIf"],
    ["column(match c with | Red -> A | Blue -> spinner())", "TileMatch"],
    ["box(Btn)", "TileCall Btn"],
    ['column(text("a"))', "TileCall text"],
    ["column(for x in [1, 2] text(x.show))", "TileFor"],
  ])("%s is %s", (tile, shape) => {
    expect(shapeOf(argOf(tile, 0))).toBe(shape);
    expect(summaries(tile)).toEqual([]);
  });

  // These render none, so the tile is E0129, but it parses as a tile for the checker to refuse.
  it.each([
    ['button(Btn {id: "x"}, text="b")', "TileCall Btn"],
    ["spinner(if busy then A() else B())", "TileIf"],
    ['progress(row(text("a"), gap="md"), value=1)', "TileCall row"],
    ['image(icon(name="plus"), src="a.png")', "TileCall icon"],
  ])("parses %s as %s on a builtin that renders none", (tile, shape) => {
    expect(shapeOf(argOf(tile, 0))).toBe(shape);
  });

  it.each([
    ['text(if busy then "a" else "b")', "IfExpr"],
    ['heading(label("x"))', "Call"],
  ])("leaves a value builtin's content a value: %s is %s", (tile, shape) => {
    expect(shapeOf(argOf(tile, 0))).toBe(shape);
  });
});

describe("a builtin tile's name called where a value belongs", () => {
  const misplaced = (name: string) =>
    `E0116 "${name}" is a tile, and a tile renders only as a positional argument of a container`;

  it.each([
    'card(text("body"), header=text("a"))',
    'Btn(header=text("a"))',
    'Say(text("x"))',
    'Row(text("x"))',
  ])("is reported by its position, not its spelling: %s", (tile) => {
    expect(summaries(tile)).toContain(misplaced("text"));
    expect(summaries(tile)).not.toContain('E0116 Call to undefined function "text"');
  });

  it("is E0236 alone as a value builtin's content", () => {
    expect(codesOf(program('heading(text("x"))'))).toEqual(["E0236"]);
  });

  it("is reported as the only diagnostic where nothing else is wrong", () => {
    expect(summaries('Say(text("x"))')).toEqual([misplaced("text")]);
    expect(summaries('card(text("body"), header=text("a"))')).toEqual([misplaced("text")]);
  });

  it("is a call to the program's fn when one has that name", () => {
    expect(summaries('Say(label("x"))')).toEqual([]);
  });
});

describe("a call to an undefined tile", () => {
  it("reports the name once, and not each argument it would have read", () => {
    expect(summaries('colum(text("a"), heading("b"))')).toEqual([
      'E0105 Reference to undefined tile "colum"',
    ]);
  });
});

describe("a capitalised name with a props block in a named argument that is not a handler", () => {
  it("is a parse error, as a value has no props block", () => {
    expect(() => parse(lex(program('box(text("x"), header=A {id: "y"})')))).toThrow(
      "Expected op()), got op({)",
    );
  });
});
