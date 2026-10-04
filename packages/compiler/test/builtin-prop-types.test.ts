// A builtin tile's prop that stdlib.md §2.3.11 gives a type takes a value of
// that type, and one that cannot have it is E0201 at the value. A named
// argument and the `{…}` block are one prop (language.md §1.7.1), so both
// spellings are checked alike. A text is not read as the type it spells —
// `"false"` is no `Bool`, `"2"` no number — and an option is read by its
// `label` and `value` alone, which is why a value of another type is refused
// rather than rendered.
//
// The first block walks the whole table, so a prop added to it is checked the
// moment it is added; that the table matches the spec is
// `spec-drift.test.ts`'s. What the built app renders for the issue's shapes is
// pinned in `packages/tests/builtin-prop-types.test.ts`.

import { check, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import {
  BUILTIN_PROP_ROWS,
  type BuiltinPropType,
  PROP_TYPE_SPELLING,
} from "../src/builtin-props.ts";

const program = (home: string) => `tile Home = ${home}
type Pick = {label: Text, value: Text}
type Size = S | L
slot fruit : Text = "apple"
slot n     : Int  = 0
slot names : List(Text) = ["a", "b"]
slot opts  : List(Pick) = [{label: "Ay", value: "a"}]
slot wide  : List({label: Text, value: Text, hint: Text}) = [{label: "Ay", value: "a", hint: "h"}]
fn sizes() -> List({label: Text, value: Size}) = [{label: "Small", value: S}, {label: "Large", value: L}]
reducer close on=ui.click(_) do= n := n + 1
app R
    caps   = []
    routes = {"/" -> Home, "/404" -> Home}
    init   = []
`;

const diagnostics = (home: string) =>
  check(parse(lex(program(home)))).map((e) => `${e.code} ${e.pos.line}:${e.pos.col} ${e.message}`);

// `tile Home = ` is 12 columns wide on line 1, so a value's column is 13 plus
// its offset in the body.
const E0201 = (home: string, value: string, expected: string, actual: string) =>
  `E0201 1:${13 + home.lastIndexOf(value)} Expected ${expected} but got ${actual}`;

/**
 * Each tile with the arguments it needs to be checked clean on its own: a
 * button's text (E0701), a file input so `multiple` is allowed (E0206), a value
 * builtin's content.
 */
const BASE_ARGS: Record<string, string[]> = {
  button: [`text="b"`],
  input: [`type="file"`],
  editable: [`"e"`],
  heading: [`"h"`],
  link: [`"l"`, `to="/"`],
  video: [`src="v.mp4"`],
  details: [`summary="s"`],
};

const named = (tile: string, prop: string, value: string) =>
  `${tile}(${[...(BASE_ARGS[tile] ?? []), `${prop}=${value}`].join(", ")})`;

const block = (tile: string, prop: string, value: string) =>
  `${tile}(${(BASE_ARGS[tile] ?? []).join(", ")}) {${prop}: ${value}}`;

/** A value of another type, and the type `check` names it by. */
const WRONG: Record<BuiltinPropType, [value: string, actual: string]> = {
  Bool: [`"true"`, "Text"],
  Text: ["true", "Bool"],
  Float: [`"2"`, "Text"],
  Options: [`"a"`, "Text"],
};

/** Values of the type: an `Int` is one of a `Float`. */
const RIGHT: Record<BuiltinPropType, string[]> = {
  Bool: ["true", "n > 3"],
  Text: [`"x"`, "fruit"],
  Float: ["2", "2.5", "n"],
  Options: [`[{label: "A", value: "a"}]`, "opts"],
};

const cases = BUILTIN_PROP_ROWS.flatMap((row) =>
  row.tiles.flatMap((tile) => row.props.map((prop) => ({ tile, prop, type: row.type }))),
);

describe("every prop of the table", () => {
  it("is there to walk", () => {
    // A floor, so a table that lost its rows cannot pass the blocks below by
    // walking nothing.
    expect(cases.length).toBeGreaterThan(70);
  });

  describe.each(cases)("$tile $prop ($type)", ({ tile, prop, type }) => {
    const [value, actual] = WRONG[type];
    const expected = PROP_TYPE_SPELLING[type];

    it("is E0201 at a value of another type, as a named argument", () => {
      const home = named(tile, prop, value);
      expect(diagnostics(home)).toEqual([E0201(home, value, expected, actual)]);
    });

    it("is E0201 at a value of another type, in the {…} block", () => {
      const home = block(tile, prop, value);
      expect(diagnostics(home)).toEqual([E0201(home, value, expected, actual)]);
    });

    it.each(RIGHT[type])("takes %s in either spelling", (good) => {
      expect(diagnostics(named(tile, prop, good))).toEqual([]);
      expect(diagnostics(block(tile, prop, good))).toEqual([]);
    });
  });
});

describe("select options", () => {
  it.each([
    [
      "each Text entry of a literal",
      `select(bind=fruit, options=["apple", "pear"])`,
      [`"apple"`, `"pear"`],
    ],
    [
      "the one entry that is no record",
      `select(options=[{label: "A", value: "a"}, "pear"])`,
      [`"pear"`],
    ],
  ])("is E0201 at %s", (_, home, values) => {
    expect(diagnostics(home)).toEqual(values.map((v) => E0201(home, v, "{label, value}", "Text")));
  });

  it("is E0201 at a record entry with no value, which would write nothing when chosen", () => {
    const home = `select(options=[{label: "A"}])`;
    expect(diagnostics(home)).toEqual([E0201(home, "{label", "{label, value}", "{label: Text}")]);
  });

  it("is E0201 at a record entry with no label, which would show nothing", () => {
    const home = `select(options=[{value: "a"}])`;
    expect(diagnostics(home)).toEqual([E0201(home, "{value", "{label, value}", "{value: Text}")]);
  });

  it("is E0201 at a list whose element is no {label, value} record", () => {
    const home = "select(options=names)";
    expect(diagnostics(home)).toEqual([E0201(home, "names", "List({label, value})", "List(Text)")]);
  });

  it.each([
    ["a record with other fields too, which are not read", `[{label: "A", value: "a", hint: "x"}]`],
    ["a slot of such records", "wide"],
    ["a slot whose element type is an alias", "opts"],
    ["a fn's declared List of records", "sizes()"],
    ["a list built with .map", "names.map({label: $1, value: $1})"],
    ["values of a union", `[{label: "Any", value: None}, {label: "One", value: Some(1)}]`],
    ["the empty list", "[]"],
  ])("takes %s", (_, options) => {
    expect(diagnostics(`select(bind=fruit, options=${options})`)).toEqual([]);
  });
});

describe("what the table does not type is not checked against one", () => {
  it.each([
    // Any value shows its text: `rows="3"` is three rows, `title=1` the title "1".
    `textarea(rows="3")`,
    `modal(text("m"), title=1, onClose=close)`,
    // `bind=` names the slot written, not a value read.
    `select(bind=fruit, options=opts)`,
  ])("%s", (home) => {
    expect(diagnostics(home)).toEqual([]);
  });
});
