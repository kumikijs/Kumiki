import { BUILTIN_TILES, codegen, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { checkSource, codesOf } from "./helpers/diagnostics.ts";
import { withApp } from "./helpers/programs.ts";

const HEAD = `type Size = Small | Large
type Todo = {title: Text, done: Bool, qty: Int, size: Size}
type D = {title: Text}
slot rows : List(Todo) = [{title: "a", done: false, qty: 1, size: Small}]
slot i : Int = 0
slot m : Map(Text, Text) = {"k": "v"}
slot mt : Map(Text, Todo) = {"k": {title: "a", done: false, qty: 1, size: Small}}
slot s : Set(Text) = ["a"]
slot draft : Option(D) = Some({title: "d"})
slot title : Text = "t"
tile B = button(text="b")
`;

const program = (defs: string) => withApp(`${HEAD}${defs}`);
const diagnostics = (defs: string) => checkSource(program(defs));
const lowered = (defs: string): string =>
  codegen(parse(lex(program(defs))), { runtimeSpecifier: "./runtime.js" }).js;

describe("a bind target that steps through an index", () => {
  // Found from the lowering rather than from a list: a builtin that lowers
  // `bind=title` is one whose bind an index step has to reach.
  const binding = [...BUILTIN_TILES]
    .filter((name) =>
      lowered(`tile App = column(${name}(bind=title, value="v"))`).includes(`bind: "title"`),
    )
    .sort();

  it("is lowered into the bind of every control that binds", () => {
    expect(binding.length).toBeGreaterThan(0);
    const through = binding.filter((name) =>
      lowered(`tile App = column(${name}(bind=m["k"], value="v"))`).includes(`bind: "m"`),
    );
    expect(through).toEqual(binding);
  });

  it("carries each step to the setter, the index as the key it computes", () => {
    const js = lowered("tile App = column(input(bind=rows[i].title))");
    expect(js).toContain(`bind: "rows", bindPath: [{ at: _live["i"] },"title"]`);
    expect(js).toContain(`_s.index(_live["rows"], _live["i"])`);
    const write = lowered(`reducer r on=ui.click(B) do= rows[i].title := "x"
tile App = column(B)`);
    expect(write).toMatch(/_s\.setPath\([^\n]*\[\{ at: [^\n]*_live\["i"\]\) \}, "title"\]/);
  });

  it("checks clean on every control, from a slot index, a literal, and a for's key", () => {
    expect(
      diagnostics(`tile App = column(
  input(bind=rows[0].title), input(bind=rows[i].qty, type="number"), textarea(bind=rows[i].title),
  check(bind=rows[i].done), switch(bind=rows[i].done),
  radio(group="g", bind=rows[i].size, value=Large),
  select(bind=rows[i].size, options=[{label: "S", value: Small}]),
  slider(bind=rows[i].qty, min=0, max=9), editable("x", bind=rows[i].title),
  input(bind=m["k"]), input(bind=mt["k"].title), input(bind=draft.get.title),
  for k in mt.keys input(bind=mt[k].title))`),
    ).toEqual([]);
  });
});

describe("what the checker asks of an index step in a bind target", () => {
  it("is what it asks of the step on the left of :=, for a Set: E0602 at the step", () => {
    const [bound] = diagnostics(`tile App = column(input(bind=s["a"]))`);
    const [assigned] = diagnostics(`reducer r on=ui.click(B) do= s["a"] := true
tile App = column(B)`);
    expect(bound).toMatchObject({
      code: "E0602",
      kind: "unassignable-member",
      pos: { line: 12, col: 30 },
    });
    expect(bound?.message).toBe(
      `Cannot bind through an index into "Set": a Set has members, not places — use .add / .remove / .toggle`,
    );
    expect(bound?.message.replace("bind", "assign")).toBe(assigned?.message);
  });

  it("is reported on every control that binds", () => {
    const positions = diagnostics(
      `tile App = column(textarea(bind=s["a"]), select(bind=s["a"], options=[]))`,
    )
      .filter((d) => d.code === "E0602")
      .map((d) => d.pos);
    expect(positions).toEqual([
      { line: 12, col: 33 },
      { line: 12, col: 54 },
    ]);
  });

  it.each([
    ["a List index takes an Int, as the read and the write do", 'rows["x"].title', ["E0201"]],
    ["a call step is left to E0602", "rows.get(0).get.title", ["E0602"]],
  ])("%s", (_label, target, expected) => {
    expect(codesOf(program(`tile App = column(input(bind=${target}))`))).toEqual(expected);
  });

  it("leaves a for variable's root to E0229", () => {
    expect(codesOf(program("tile App = column(for r in rows input(bind=r.title))"))).toEqual([
      "E0229",
    ]);
  });
});
