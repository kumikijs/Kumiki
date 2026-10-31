import { BUILTIN_TILES } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { checkSource, codesOf } from "./helpers/diagnostics.ts";
import { loweredOf } from "./helpers/module.ts";
import { withApp } from "./helpers/programs.ts";

const HEAD = `type D = {title: Text}
slot title : Text = "t"
slot xs : List(Text) = ["a"]
slot grid : List(List(Text)) = [["a"]]
slot sel : Option(Text) = Some("s")
slot d : Option(D) = Some({title: "a"})
fn ident(t: Text) -> Text = t
`;

const program = (defs: string) => withApp(`${HEAD}${defs}`);
const e0229 = (defs: string) => checkSource(program(defs)).filter((d) => d.code === "E0229");

/** What E0229 says the root is: the text after "cannot write to ", up to the first " — " or ". ". */
const said = (defs: string): string[] =>
  e0229(defs).map((d) => d.message.replace(/^.*?cannot write to (.*?)(?: — |\. ).*$/, "$1"));

describe("a bind target whose root is not a slot", () => {
  it("is E0229 at the target, naming the root and what it is", () => {
    const source = withApp(`type Todo = {text: Text}
slot todos : List(Todo) = [{text: "milk"}]
slot title : Text = "t"
tile Row in=Text = input(bind=$1, id="row")
tile App = column(
  for t in todos input(bind=t.text, id="fx"),
  Row(title),
  input(bind="title", id="lit"),
  text("todos=" + todos.map($1.text).join(",")),
  text("title=" + title))`);
    const reported = checkSource(source).map((d) => [d.code, d.kind, d.pos, d.message]);
    const tail = "a bind writes back to a slot or a path into one";
    const see = "(see docs/spec/forms.md)";
    expect(reported).toEqual([
      [
        "E0229",
        "bind-target-not-slot",
        { line: 4, col: 31 },
        `input(bind=…) cannot write to "$1": it is this tile's input, not a slot — ${tail}. Bind the slot by its name, or show $1 with value= and write the slot from a reducer ${see}`,
      ],
      [
        "E0229",
        "bind-target-not-slot",
        { line: 6, col: 29 },
        `input(bind=…) cannot write to "t": it is the variable of a for, not a slot — ${tail}. To edit a row, bind it through the slot by a Map key or an index the page holds (bind=rows[i].title), or show it with value= and update the list from a reducer ${see}`,
      ],
      [
        "E0229",
        "bind-target-not-slot",
        { line: 8, col: 14 },
        `input(bind=…) cannot write to the text literal "title": a literal is a value, not a slot — ${tail}. Write the slot's name without quotes: bind=title ${see}`,
      ],
    ]);
  });
});

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
      `"route": it is the route slot, which only navigation writes`,
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

  it("does not send a literal to a name a local hides", () => {
    // Unquoted, `title` is the for variable here, which is E0229 again.
    const [hidden] = e0229(`tile App = column(for title in xs input(bind="title"))`);
    expect(hidden?.message).not.toContain("without quotes");
    expect(hidden?.message).toContain("Bind a slot");
  });

  it("sends a route bind to navigation", () => {
    expect(e0229("tile App = column(input(bind=route.path))").map((d) => d.message)).toEqual([
      `input(bind=…) cannot write to "route": it is the route slot, which only navigation writes. Move it with link(to=…) or emit navigate(…) (see docs/spec/routing.md)`,
    ]);
  });
});

describe("what a name was bound by, after a scope that binds it again", () => {
  // Each inner scope rebinds the name in a copy of its parent's binders, so
  // the name is what bound it once that scope ends.
  it.each([
    [
      "a for variable, after a let of its name",
      `tile App = column(for t in xs column(text(let t = "x" in t), input(bind=t)))`,
      `"t": it is the variable of a for, not a slot`,
    ],
    [
      "a tile's input, after a fragment that rebinds $1",
      `tile Row in=Text = column(text(xs.map($1).join(",")), input(bind=$1))
tile App = column(Row(title))`,
      `"$1": it is this tile's input, not a slot`,
    ],
    [
      "a match binding that hides a for variable of its name",
      'tile App = column(for s in xs match sel with\n  | Some(s) -> input(bind=s)\n  | None -> text("none"))',
      `"s": it is a local name, not a slot`,
    ],
  ])("%s", (_label, defs, what) => {
    expect(said(defs)).toEqual([what]);
  });
});

describe("a root another code reports", () => {
  it.each([
    ["a name that resolves to nothing", "input(bind=nope.title)", ["E0103"]],
    ["a fn named as a value", "input(bind=ident)", ["E0127"]],
    ["a text literal on a file input", `input(type="file", bind="title")`, ["E0205"]],
    ["a for variable on a file input", `for x in xs input(type="file", bind=x)`, ["E0205"]],
  ])("is not E0229 as well: %s", (_label, call, expected) => {
    expect(codesOf(program(`tile App = column(${call})`))).toEqual(expected);
  });
});

describe("a call step in a bind target", () => {
  it("is E0602 alone on a slot root", () => {
    expect(codesOf(program("tile App = column(input(bind=d.get().title))"))).toEqual(["E0602"]);
  });

  it("is E0602 at the call, and the root is still asked", () => {
    expect(codesOf(program("tile App = column(for x in xs input(bind=x.upper()))"))).toEqual([
      "E0602",
      "E0229",
    ]);
  });
});

describe("a bind written in the props block", () => {
  // The block spelling lowers no bind today, so it writes nothing and there is
  // no root to ask. A lowering that reads `{bind: …}` as a bind writes a for
  // variable into the slot table from there too, and this then fails until
  // E0229 reads the target from the block as well.
  it.each([
    ["as a named argument", `input(bind=t, id="r")`],
    ["in the props block", `input(id="r") {bind: t}`],
  ])("is asked whenever the lowering writes it: %s", (_label, call) => {
    const defs = `tile App = column(for t in xs ${call})`;
    const writes = loweredOf(program(defs)).includes(`bind: "t"`);
    expect(e0229(defs).length > 0).toBe(writes);
  });
});

describe("the controls the root is asked of", () => {
  // Found from the lowering rather than from a list: a builtin lowers a bind
  // when its output carries the slot the target names. `value="v"` is there
  // for `radio`, which lowers its bind only beside a value= (E0225).
  const lowersBind = (name: string): boolean =>
    loweredOf(program(`tile App = column(${name}(bind=title, value="v"))`)).includes(
      `bind: "title"`,
    );

  it("are the builtins that lower a bind", () => {
    const lowering = [...BUILTIN_TILES].filter(lowersBind).sort();
    const asked = [...BUILTIN_TILES]
      .filter(
        (name) => e0229(`tile App = column(for x in xs ${name}(bind=x, value="v"))`).length > 0,
      )
      .sort();
    expect(lowering.length).toBeGreaterThan(0);
    expect(asked).toEqual(lowering);
  });
});

describe("a bind target whose root is a slot", () => {
  const SLOTS = `type Filter = All | Active
type Addr = {city: Text}
type Form = {email: Text, age: Int, addr: Addr, agree: Bool, size: Filter}
type D = {title: Text}
slot name : Text = "a"
slot n : Int = 1
slot flag : Bool = false
slot filter : Filter = All
slot form : Form = {email: "e", age: 1, addr: {city: "c"}, agree: false, size: All}
slot d : Option(D) = Some({title: "a"})
slot limit : Option(Int) = Some(3)
slot xs : List(Text) = ["a"]
`;
  it.each([
    [
      "a slot, on every control that binds",
      `tile App = column(
  input(bind=name), input(bind=n, type="number"), textarea(bind=name),
  select(bind=filter, options=[{label: "All", value: All}]), slider(bind=n, min=0, max=9),
  check(bind=flag), switch(bind=flag), radio(group="g", bind=filter, value=Active),
  editable("x", bind=name))`,
    ],
    [
      "a field path into one",
      `tile App = column(input(bind=form.email), input(bind=form.age, type="number"),
  check(bind=form.agree), radio(group="g", bind=form.size, value=All))`,
    ],
    [
      "a nested field path",
      `tile App = column(input(bind=form.addr.city), textarea(bind=form.addr.city))`,
    ],
    [
      "an Option's payload, through .get",
      `tile App = column(input(bind=d.get.title), input(bind=limit.get, type="number"))`,
    ],
    [
      "a slot named inside a tile that takes an input, called from a for",
      `tile Field in=Text = column(label(text=$1), input(bind=form.email), input(bind=name))
tile App = column(Field("Email"), for x in xs Field(x))`,
    ],
    [
      "a slot bound after a for that hid it",
      "tile App = column(for name in xs text(name), input(bind=name))",
    ],
    [
      "a slot bound inside a for over another name",
      "tile App = column(for x in xs row(text(x), input(bind=name)))",
    ],
  ])("checks clean: %s", (_label, tiles) => {
    expect(checkSource(withApp(`${SLOTS}${tiles}`))).toEqual([]);
  });
});
