// `error(field=…)` takes a slot, or a path into one (forms.md §5.7.1): field
// steps, `.get`, and indices with a literal key. Anything else names no place
// whose failure the tile could render, so it is E0230 where it is written,
// rather than a tile that checks and renders nothing.

import { check, compile, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

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
const TAIL = `app A caps=[] routes={"/" -> App, "/404" -> App} init=[]`;
const errorsOf = (tile: string) => check(parse(lex(`${DEFS}\n${tile}\n${TAIL}`)));
const codesOf = (tile: string) => errorsOf(tile).map((e) => e.code);

describe("a field= that is not a slot or a path into one is E0230", () => {
  const bad: [string, string, string][] = [
    [
      "a text literal that spells a slot's name",
      `tile App = error(field="form")`,
      `error(field=…) cannot show the failure of the text literal "form": a literal is a value, not a slot. field= names a slot, or a path into one — write the slot's name without quotes: error(field=form) (see docs/spec/forms.md §5.7.1)`,
    ],
    [
      "a text literal",
      `tile App = error(field="nope")`,
      `error(field=…) cannot show the failure of the text literal "nope": a literal is a value, not a slot. field= names a slot, or a path into one (see docs/spec/forms.md §5.7.1)`,
    ],
    [
      "a number literal",
      `tile App = error(field=3)`,
      `error(field=…) cannot show the failure of the literal 3: a literal is a value, not a slot. field= names a slot, or a path into one (see docs/spec/forms.md §5.7.1)`,
    ],
    [
      "an expression",
      `tile App = error(field=i + 1)`,
      `error(field=…) cannot show the failure of this expression: it computes a value, not a slot. field= names a slot, or a path into one (see docs/spec/forms.md §5.7.1)`,
    ],
    [
      "a tile",
      `tile App = error(field=text("form"))`,
      `error(field=…) cannot show the failure of a tile: a tile is not a slot. field= names a slot, or a path into one (see docs/spec/forms.md §5.7.1)`,
    ],
    [
      "the variable of a for",
      `tile App = column(for x in xs error(field=x))`,
      `error(field=…) cannot show the failure of "x": it is a local name, not a slot. field= names a slot, or a path into one (see docs/spec/forms.md §5.7.1)`,
    ],
    [
      "a tile's input",
      `tile Row in=Contact = error(field=$1.email)\ntile App = Row(form)`,
      `error(field=…) cannot show the failure of "$1": it is a local name, not a slot. field= names a slot, or a path into one (see docs/spec/forms.md §5.7.1)`,
    ],
    [
      "a name the runtime provides",
      `tile App = error(field=route)`,
      `error(field=…) cannot show the failure of "route": it is not a slot. field= names a slot, or a path into one (see docs/spec/forms.md §5.7.1)`,
    ],
    [
      "a member, which derives a value",
      `tile App = error(field=form.email.length)`,
      `error(field=…) cannot step through ".length": it is a member of "Text", not a field. A path's steps are fields, ".get", and indices with a literal key (see docs/spec/forms.md §5.7.1)`,
    ],
    [
      "a call",
      `tile App = error(field=form.email.trim())`,
      `error(field=…) cannot step through ".trim()": a call is not a step of a path. A path's steps are fields, ".get", and indices with a literal key (see docs/spec/forms.md §5.7.1)`,
    ],
    [
      "an index computed from a value",
      `tile App = error(field=xs[i])`,
      `error(field=…) cannot step through an index that is not a literal: a path names one element or entry by a literal key, such as [0] or ["k"] (see docs/spec/forms.md §5.7.1)`,
    ],
    [
      "an index into a record",
      `tile App = error(field=form[0])`,
      `error(field=…) cannot step through an index into "Contact": an index names a List element or a Map entry (see docs/spec/forms.md §5.7.1)`,
    ],
  ];
  for (const [label, tile, message] of bad) {
    it(`reports ${label}`, () => {
      const e0230 = errorsOf(tile).filter((e) => e.code === "E0230");
      expect(e0230.map((e) => [e.kind, e.message])).toEqual([["error-field-not-path", message]]);
    });
  }

  it("points at an index's key", () => {
    const tile = `tile App = error(field=rows[i].email)`;
    const [e] = errorsOf(tile).filter((x) => x.code === "E0230");
    expect(e?.pos.col).toBe(`tile App = error(field=rows[`.length + 1);
  });
});

describe("a slot, or a path into one, is accepted", () => {
  const good: [string, string][] = [
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
  ];
  for (const [label, tile] of good) {
    it(`accepts ${label}`, () => {
      expect(codesOf(tile)).toEqual([]);
    });
  }
});

describe("a path another code reports is not E0230 as well", () => {
  const other: [string, string, string][] = [
    ["a field the record lacks", `tile App = error(field=form.emial)`, "E0108"],
    ["a name that resolves to nothing", `tile App = error(field=nope)`, "E0103"],
    ["a List index that is not an Int", `tile App = error(field=xs["a"])`, "E0201"],
  ];
  for (const [label, tile, code] of other) {
    it(`leaves ${label} to ${code}`, () => {
      expect(codesOf(tile)).toEqual([code]);
    });
  }
});

describe("the error node names its slot and the path into it", () => {
  const nodeOf = (tile: string): string => {
    const r = compile(`${DEFS}\n${tile}\n${TAIL}`, { runtimeSpecifier: "@kumikijs/runtime" });
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

  it("lowers each step the way the runtime's PathSegment spells it", () => {
    expect(nodeOf(`tile App = error(field=rows[1].email)`)).toBe(
      `({ kind: "error", field: "rows", path: [{"at":1},"email"], props: {  } })`,
    );
    expect(nodeOf(`tile App = error(field=draft.get.title)`)).toBe(
      `({ kind: "error", field: "draft", path: [{"get":true},"title"], props: {  } })`,
    );
    expect(nodeOf(`tile App = error(field=m["a"])`)).toBe(
      `({ kind: "error", field: "m", path: [{"at":"a"}], props: {  } })`,
    );
  });
});
