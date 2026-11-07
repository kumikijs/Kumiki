import { BUILTIN_TILES } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { codesOf, pointedErrorsOf, summariesOf } from "./helpers/diagnostics.ts";
import { loweredOf } from "./helpers/module.ts";
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
const lowered = (defs: string): string => loweredOf(program(defs));

const BINDING_CONTROLS = [
  "check",
  "editable",
  "input",
  "radio",
  "select",
  "slider",
  "switch",
  "textarea",
];

describe("a bind target that steps through an index", () => {
  // Found from the lowering rather than from a list: a builtin that lowers
  // `bind=title` is one whose bind an index step has to reach.
  const binding = [...BUILTIN_TILES]
    .filter((name) =>
      lowered(`tile App = column(${name}(bind=title, value="v"))`).includes(`bind: "title"`),
    )
    .sort();

  it("is lowered into the bind of every control that binds", () => {
    expect(binding).toEqual(BINDING_CONTROLS);
    const through = binding.filter((name) =>
      lowered(`tile App = column(${name}(bind=m["k"], value="v"))`).includes(
        `bind: "m", bindPath: [{ at: "k" }]`,
      ),
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
      summariesOf(
        program(`tile App = column(
  input(bind=rows[0].title), input(bind=rows[i].qty, type="number"), textarea(bind=rows[i].title),
  check(bind=rows[i].done), switch(bind=rows[i].done),
  radio(group="g", bind=rows[i].size, value=Large),
  select(bind=rows[i].size, options=[{label: "S", value: Small}]),
  slider(bind=rows[i].qty, min=0, max=9), editable("x", bind=rows[i].title),
  input(bind=m["k"]), input(bind=mt["k"].title), input(bind=draft.get.title),
  for k in mt.keys input(bind=mt[k].title))`),
      ),
    ).toEqual([]);
  });
});

describe("what the checker asks of an index step in a bind target", () => {
  it("is what it asks of the step on the left of :=, for a record: E0602 naming the field step", () => {
    const target = `draft.get["title"]`;
    const message = `Cannot bind through an index into "D": an index names a place only in a Map or a List — write the field step ".title"`;
    expect(pointedErrorsOf(program(`tile App = column(input(bind=${target}))`))).toEqual([
      { code: "E0602", message, text: `${target}))` },
    ]);
    expect(
      summariesOf(
        program(`reducer r on=ui.click(B) do= ${target} := "x"
tile App = column(B)`),
      ),
    ).toEqual([`E0602 ${message.replace("bind", "assign")}`]);
  });

  it("is reported on every control that binds", () => {
    const message = `Cannot bind through an index into "D": an index names a place only in a Map or a List — write the field step ".title"`;
    const target = `draft.get["title"]`;
    expect(
      pointedErrorsOf(
        program(`tile App = column(textarea(bind=${target}), select(bind=${target}, options=[]))`),
      ),
    ).toEqual([
      { code: "E0602", message, text: `${target}), select(bind=${target}, options=[]))` },
      { code: "E0602", message, text: `${target}, options=[]))` },
    ]);
  });

  // The control shows its target before it writes one, and that read is the one report.
  it.each([
    [
      "a Set to E0232",
      `s["a"]`,
      "true",
      `E0232 Cannot read through an index into "Set(Text)": a Set has members, not places — use .has`,
      `E0602 Cannot assign through an index into "Set(Text)": a Set has members, not places — use .add / .remove / .toggle`,
    ],
    [
      "an Int to E0238",
      "i[0]",
      "1",
      `E0238 Cannot read through an index into "Int": an index names a place only in a Map or a List`,
      `E0602 Cannot assign through an index into "Int": an index names a place only in a Map or a List`,
    ],
  ])("leaves %s, the read's code, where the step on the left of := is E0602", (_label, target, value, read, write) => {
    const key = target.slice(target.lastIndexOf("[") + 1);
    expect(
      pointedErrorsOf(program(`tile App = column(input(bind=${target}))`)).map(
        (e) => `${e.code} ${e.message} @ ${e.text}`,
      ),
    ).toEqual([`${read} @ ${key}))`]);
    expect(
      summariesOf(
        program(`reducer r on=ui.click(B) do= ${target} := ${value}
tile App = column(B)`),
      ),
    ).toEqual([write]);
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
