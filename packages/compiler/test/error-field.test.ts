import { compile } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { checkSource, codesOf } from "./helpers/diagnostics.ts";
import { withApp } from "./helpers/programs.ts";

const DEFS = `
type Contact = {email: Text where email, age: Int where between(0, 120)}
type Post    = {title: Text where nonempty}
slot form  : Contact                        = {email: "", age: 0}
slot draft : Option(Post)                   = None
slot res   : Result(Post, Text)             = Err("x")
slot xs    : List(Text where email)         = []
slot rows  : List(Contact)                  = []
slot m     : Map(Text, Text where nonempty) = {}
slot n     : Map(Int, Text where nonempty)  = {}
slot i     : Int                            = 0
`;
const program = (tile: string) => withApp(`${DEFS}\n${tile}`);
const SEE = "(see docs/spec/forms.md)";
const ROOT_TAIL = "field= names a slot, or a path into one";
const STEPS = `A path's steps are fields, ".get", and indices with a literal key ${SEE}`;

describe("a field= that is not a slot or a path into one is E0230", () => {
  it.each([
    [
      "a text literal that spells a slot's name",
      `tile App = error(field="form")`,
      `error(field=…) cannot show the failure of the text literal "form": a literal is a value, not a slot. ${ROOT_TAIL} — write the slot's name without quotes: error(field=form) ${SEE}`,
    ],
    [
      "a text literal",
      `tile App = error(field="nope")`,
      `error(field=…) cannot show the failure of the text literal "nope": a literal is a value, not a slot. ${ROOT_TAIL} ${SEE}`,
    ],
    [
      "a number literal",
      `tile App = error(field=3)`,
      `error(field=…) cannot show the failure of the literal 3: a literal is a value, not a slot. ${ROOT_TAIL} ${SEE}`,
    ],
    [
      "an expression",
      `tile App = error(field=i + 1)`,
      `error(field=…) cannot show the failure of this expression: it computes a value, not a slot. ${ROOT_TAIL} ${SEE}`,
    ],
    [
      "a tile",
      `tile App = error(field=text("form"))`,
      `error(field=…) cannot show the failure of a tile: a tile is not a slot. ${ROOT_TAIL} ${SEE}`,
    ],
    [
      "the variable of a for",
      `tile App = column(for x in xs error(field=x))`,
      `error(field=…) cannot show the failure of "x": it is a local name, not a slot. ${ROOT_TAIL} ${SEE}`,
    ],
    [
      "a tile's input",
      `tile Row in=Contact = error(field=$1.email)\ntile App = Row(form)`,
      `error(field=…) cannot show the failure of "$1": it is a local name, not a slot. ${ROOT_TAIL} ${SEE}`,
    ],
    [
      "a name the runtime provides",
      `tile App = error(field=route)`,
      `error(field=…) cannot show the failure of "route": it is not a slot. ${ROOT_TAIL} ${SEE}`,
    ],
    [
      "a member, which derives a value",
      `tile App = error(field=form.email.length)`,
      `error(field=…) cannot step through ".length": it is a member of "Text", not a field. ${STEPS}`,
    ],
    [
      "a call",
      `tile App = error(field=form.email.trim())`,
      `error(field=…) cannot step through ".trim()": a call is not a step of a path. ${STEPS}`,
    ],
    [
      "an index computed from a value",
      `tile App = error(field=xs[i])`,
      `error(field=…) cannot step through an index that is not a literal: a path names one element or entry by a literal key, such as [0] or ["k"] ${SEE}`,
    ],
    [
      "an index into a record",
      `tile App = error(field=form[0])`,
      `error(field=…) cannot step through an index into "Contact": an index names a List element or a Map entry ${SEE}`,
    ],
  ])("reports %s", (_label, tile, message) => {
    const e0230 = checkSource(program(tile)).filter((e) => e.code === "E0230");
    expect(e0230.map((e) => [e.kind, e.message])).toEqual([["error-field-not-path", message]]);
  });

  it("points at an index's key", () => {
    const tile = `tile App = error(field=rows[i].email)`;
    const [e] = checkSource(program(tile)).filter((x) => x.code === "E0230");
    expect(e?.pos.col).toBe(`tile App = error(field=rows[`.length + 1);
  });
});

describe("a slot, or a path into one, is accepted", () => {
  it.each([
    ["a slot", `tile App = error(field=form)`],
    ["a record field", `tile App = error(field=form.email)`],
    ["an Option's payload through .get", `tile App = error(field=draft.get.title)`],
    ["a Result's Ok payload through .get", `tile App = error(field=res.get.title)`],
    ["a List element at a literal index", `tile App = error(field=xs[0])`],
    ["a field of a List element", `tile App = error(field=rows[1].email)`],
    ["a Map entry at a literal key", `tile App = error(field=m["a"])`],
    ["a Map entry at an Int key", `tile App = error(field=n[3])`],
    ["no field at all", `tile App = error()`],
    [
      "a path beside a bound control in a form",
      `tile App = form(input(bind=form.email), error(field=form.email))`,
    ],
  ])("accepts %s", (_label, tile) => {
    expect(codesOf(program(tile))).toEqual([]);
  });
});

describe("a path another code reports is not E0230 as well", () => {
  it.each([
    ["a field the record lacks", `tile App = error(field=form.emial)`, "E0108"],
    ["a name that resolves to nothing", `tile App = error(field=nope)`, "E0103"],
    ["a List index that is not an Int", `tile App = error(field=xs["a"])`, "E0201"],
  ])("leaves %s to %s", (_label, tile, code) => {
    expect(codesOf(program(tile))).toEqual([code]);
  });
});

describe("the error node names its slot and the path into it", () => {
  const nodeOf = (tile: string): string => {
    const r = compile(program(tile), { runtimeSpecifier: "@kumikijs/runtime" });
    if (r.kind !== "ok") throw new Error(JSON.stringify(r.errors));
    const m = r.js.match(/\(\{ kind: "error"[^\n]*?\}\)/);
    if (!m) throw new Error("no error node in the output");
    return m[0];
  };

  it("lowers a slot to its name, with no path", () => {
    expect(nodeOf(`tile App = error(field=form)`)).toBe(
      `({ kind: "error", field: "form", props: {  } })`,
    );
  });

  it.each([
    [`rows[1].email`, `({ kind: "error", field: "rows", path: [{"at":1},"email"], props: {  } })`],
    [
      `draft.get.title`,
      `({ kind: "error", field: "draft", path: [{"get":true},"title"], props: {  } })`,
    ],
    [`m["a"]`, `({ kind: "error", field: "m", path: [{"at":"a"}], props: {  } })`],
  ])("lowers each step of %s the way the runtime's PathSegment spells it", (field, node) => {
    expect(nodeOf(`tile App = error(field=${field})`)).toBe(node);
  });
});
