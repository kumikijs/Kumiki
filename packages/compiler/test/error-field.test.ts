import type { TileNode } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { checkSource, codesOf } from "./helpers/diagnostics.ts";
import { loadApp } from "./helpers/module.ts";
import { withApp } from "./helpers/programs.ts";

const DEFS = `
type Contact = {email: Text where email, age: Int where between(0, 120)}
type Post    = {title: Text where nonempty}
type Pair    = {pair: Tuple(Text where email, Int where between(18, 120))}
type Shape   = Circle(Int where positive) | Square(Int where positive)
type Drawing = {shape: Shape}
slot form  : Contact                         = {email: "", age: 0}
slot draft : Option(Post)                    = None
slot res   : Result(Post, Text)              = Err("x")
slot xs    : List(Text where email)          = []
slot rows  : List(Contact)                   = []
slot m     : Map(Text, Text where nonempty)  = {}
slot n     : Map(Int, Text where nonempty)   = {}
slot fm    : Map(Float, Text where nonempty) = {}
slot b     : Map(Bool, Text where nonempty)  = {}
slot opts  : List(Option(Post))              = []
slot maybe : Option(List(Text where email))  = None
slot grid  : List(List(Text where email))    = []
slot book  : Map(Text, Contact)              = {}
slot r     : Pair                            = {pair: ("", 0)}
slot d     : Drawing                         = {shape: Circle(0)}
slot i     : Int                             = 0
fn shout(t: Text) -> Text = t
`;
const program = (tile: string) => withApp(`${DEFS}\n${tile}`);
const diagnosticsOf = (tile: string): string[][] =>
  checkSource(program(tile)).map((e) => [e.code, e.kind, e.message]);
const SEE = "(see docs/spec/forms.md)";
const ROOT_TAIL = "field= names a slot, or a path into one";
const STEPS = `A path's steps are fields, ".get", and indices with a literal key ${SEE}`;
const E0230 = (message: string): string[] => ["E0230", "error-field-not-path", message];

describe("a field= that is not a slot or a path into one is E0230", () => {
  it.each([
    [
      "a text literal that spells a slot's name",
      `tile App = error(field="form")`,
      `error(field=…) cannot show the failure of the text literal "form": a literal is a value, not a slot. ${ROOT_TAIL} — write the slot's name without quotes: error(field=form) ${SEE}`,
    ],
    [
      "a text literal that spells a local's name, which hides the slot",
      `tile App = column(for form in rows error(field="form"))`,
      `error(field=…) cannot show the failure of the text literal "form": a literal is a value, not a slot. ${ROOT_TAIL} ${SEE}`,
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
      "a negative number literal",
      `tile App = error(field=-3)`,
      `error(field=…) cannot show the failure of the literal -3: a literal is a value, not a slot. ${ROOT_TAIL} ${SEE}`,
    ],
    [
      "an expression",
      `tile App = error(field=i + 1)`,
      `error(field=…) cannot show the failure of this expression: it computes a value, not a slot. ${ROOT_TAIL} ${SEE}`,
    ],
    [
      "the variable of a for",
      `tile App = column(for x in xs error(field=x))`,
      `error(field=…) cannot show the failure of "x": it is a local name, not a slot. ${ROOT_TAIL} ${SEE}`,
    ],
    [
      "a local that hides a slot of its name",
      `tile App = column(for form in rows error(field=form.email))`,
      `error(field=…) cannot show the failure of "form": it is a local name, not a slot. ${ROOT_TAIL} ${SEE}`,
    ],
    [
      "a tile's input",
      `tile Row in=Contact = error(field=$1.email)\ntile App = Row(form)`,
      `error(field=…) cannot show the failure of "$1": it is a local name, not a slot. ${ROOT_TAIL} ${SEE}`,
    ],
    [
      "the route slot",
      `tile App = error(field=route)`,
      `error(field=…) cannot show the failure of "route": it is the route slot, whose type carries no refinement to fail. ${ROOT_TAIL} ${SEE}`,
    ],
    [
      "a for, which a named argument holds as a tile",
      `tile App = error(field=for x in xs text(x))`,
      `error(field=…) cannot show the failure of a "for": it is a tile, not a slot. ${ROOT_TAIL} ${SEE}`,
    ],
    [
      "a member, which derives a value",
      `tile App = error(field=form.email.length)`,
      `error(field=…) cannot step through ".length": it is a member of "Text", not a field. ${STEPS}`,
    ],
    [
      "a Map's .get, which is a member rather than an unwrap",
      `tile App = error(field=m.get)`,
      `error(field=…) cannot step through ".get": it is a member of "Map", not a field. ${STEPS}`,
    ],
    [
      "a step into a Tuple",
      `tile App = error(field=r.pair._1)`,
      `error(field=…) cannot step through "._1": "Tuple(Text, Int)" has no fields. ${STEPS}`,
    ],
    [
      "a misspelt step into a union",
      `tile App = error(field=d.shape.nmae)`,
      `error(field=…) cannot step through ".nmae": "Shape" has no fields. ${STEPS}`,
    ],
    [
      "a variant's name as a step into a union",
      `tile App = error(field=d.shape.Square)`,
      `error(field=…) cannot step through ".Square": "Shape" has no fields. ${STEPS}`,
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
      `error(field=…) cannot step through an index into "Contact": a path's index names a List element or a Map entry ${SEE}`,
    ],
    [
      "an index into a Tuple",
      `tile App = error(field=r.pair[0])`,
      `error(field=…) cannot step through an index into "Tuple(Text, Int)": a path's index names a List element or a Map entry ${SEE}`,
    ],
    [
      "no field at all",
      `tile App = error()`,
      `error() names no field, so it has no failure to show: ${ROOT_TAIL} ${SEE}`,
    ],
    [
      "a text literal in the props block, which is read as field= is",
      `tile App = error() {field: "nope"}`,
      `error(field=…) cannot show the failure of the text literal "nope": a literal is a value, not a slot. ${ROOT_TAIL} ${SEE}`,
    ],
  ])("reports %s, and nothing else", (_label, tile, message) => {
    expect(diagnosticsOf(tile)).toEqual([E0230(message)]);
  });

  it("is reported beside a warning at the same position", () => {
    expect(diagnosticsOf(`tile App = error(field=fmt("{0}{1}", form.email))`)).toEqual([
      [
        "W0214",
        "fmt-placeholder-argument-mismatch",
        "fmt template and arguments disagree: {1} has no argument",
      ],
      E0230(
        `error(field=…) cannot show the failure of this expression: it computes a value, not a slot. ${ROOT_TAIL} ${SEE}`,
      ),
    ]);
  });

  it("points at an index's key", () => {
    const tile = `tile App = error(field=rows[i].email)`;
    const [e] = checkSource(program(tile)).filter((x) => x.code === "E0230");
    expect(e?.pos.col).toBe(`tile App = error(field=rows[`.length + 1);
  });
});

describe("a slot, or a path into one, is accepted", () => {
  it.each([
    ["a slot", `form`],
    ["a record field", `form.email`],
    ["an Option's payload through .get", `draft.get.title`],
    ["a Result's Ok payload through .get", `res.get.title`],
    ["a List element at a literal index", `xs[0]`],
    ["a List element at a negative index, which names none", `xs[-1]`],
    ["a field of a List element", `rows[1].email`],
    ["a Map entry at a literal key", `m["a"]`],
    ["a Map entry at an Int key", `n[3]`],
    ["a Map entry at a negative Int key", `n[-1]`],
    ["a Map entry at a negative Float key", `fm[-1.5]`],
    ["a Map entry at a Bool key", `b[true]`],
    ["an Option's payload through a List element", `opts[0].get.title`],
    ["a List element through an Option's payload", `maybe.get[1]`],
    ["an element of an element", `grid[0][1]`],
    ["a field of a Map entry", `book["b"].age`],
  ])("accepts %s", (_label, field) => {
    expect(codesOf(program(`tile App = error(field=${field})`))).toEqual([]);
  });

  it("accepts a path in the props block", () => {
    expect(codesOf(program(`tile App = error() {field: draft.get.title}`))).toEqual([]);
  });

  it("accepts a path beside a bound control in a form", () => {
    const tile = `tile App = form(input(bind=form.email), error(field=form.email))`;
    expect(codesOf(program(tile))).toEqual([]);
  });
});

describe("a path another code reports is not E0230 as well", () => {
  it.each([
    ["a field the record lacks", `form.emial`, "E0108"],
    ["a member named without its call", `form.email.contains`, "E0213"],
    ["a name that resolves to nothing", `nope`, "E0103"],
    ["a fn named without a call", `shout`, "E0127"],
    ["a List index that is not an Int", `xs["a"]`, "E0201"],
    ["a Map key of another type", `m[3]`, "E0201"],
    ["a call to a name no fn defines, such as a tile written as a value", `text("form")`, "E0116"],
  ])("leaves %s to %s", (_label, field, code) => {
    expect(codesOf(program(`tile App = error(field=${field})`))).toEqual([code]);
  });

  it.each([
    "s[0]",
    "s.x",
  ])("leaves a step into a slot whose type names nothing to E0117: %s", (field) => {
    const src = withApp(`slot s : Nope = 0\ntile App = error(field=${field})`);
    expect(codesOf(src)).toEqual(["E0117"]);
  });
});

describe("the error node names its slot and the path into it", () => {
  const errorNode = async (tile: string) => {
    const app = await loadApp<{ routes: { tile: () => TileNode }[] }>(
      program(`tile App = ${tile}`),
    );
    return app.routes[0]?.tile() as Extract<TileNode, { kind: "error" }>;
  };

  it.each<[string, string, unknown[]]>([
    ["form", "form", []],
    ["rows[1].email", "rows", [{ at: 1 }, "email"]],
    ["draft.get.title", "draft", [{ get: true }, "title"]],
    [`m["a"]`, "m", [{ at: "a" }]],
    ["n[-1]", "n", [{ at: -1 }]],
    ["b[true]", "b", [{ at: true }]],
  ])("lowers %s to the slot %s and the path %j", async (field, slot, path) => {
    const node = await errorNode(`error(field=${field})`);
    expect([node.field, node.path]).toEqual([slot, path]);
  });

  it.each<[string, string, string, unknown[]]>([
    ["the props block", `error() {field: rows[1].email}`, "rows", [{ at: 1 }, "email"]],
    [
      "the props block over the argument",
      `error(field=form) {field: draft.get.title}`,
      "draft",
      [{ get: true }, "title"],
    ],
  ])("reads the path from %s", async (_label, tile, slot, path) => {
    const node = await errorNode(tile);
    expect([node.field, node.path]).toEqual([slot, path]);
  });
});
