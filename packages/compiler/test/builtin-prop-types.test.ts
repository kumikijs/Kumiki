import { describe, expect, it } from "vitest";
import { checkSource, pointedErrorsOf } from "./helpers/diagnostics.ts";
import { withApp } from "./helpers/programs.ts";

const source = (home: string) =>
  withApp(`type Pick = {label: Text, value: Text}
type Opts = List(Pick)
type Size = S | L
slot fruit   : Text = "apple"
slot n       : Int  = 0
slot flag    : Bool = true
slot size    : Size = S
slot names   : List(Text) = ["a", "b"]
slot opts    : List(Pick) = [{label: "Ay", value: "a"}]
slot aliased : Opts = [{label: "Ay", value: "a"}]
slot picks   : Set(Pick) = {}
slot wide    : List({label: Text, value: Text, hint: Text}) = [{label: "Ay", value: "a", hint: "h"}]
fn sizes() -> List({label: Text, value: Size}) = [{label: "Small", value: S}, {label: "Large", value: L}]
reducer close on=ui.click(_) do= n := n + 1
tile App = ${home}`);

const diagnostics = (home: string) => checkSource(source(home));

/** The E0201s of `home`, each `[message, the text of `home` from where it points]`. */
const E0201s = (home: string) =>
  pointedErrorsOf(source(home)).map((e) => [`${e.code} ${e.message}`, e.text]);

/** `home` from `needle` on: what a diagnostic reported at `needle` points at. */
function from(home: string, needle: string): string {
  const at = home.indexOf(needle);
  if (at < 0) throw new Error(`${needle} does not occur in ${home}`);
  return home.slice(at);
}

type PropType = "Bool" | "Text" | "Float" | "Options";

const INPUTS = [
  "button",
  "input",
  "textarea",
  "check",
  "radio",
  "select",
  "slider",
  "switch",
  "editable",
];

// Transcribed from stdlib.md §2.3.11, row by row.
const SPEC: [props: string[], type: PropType, tiles: string[]][] = [
  [["disabled", "readonly", "required", "auto-focus"], "Bool", INPUTS],
  [["placeholder", "auto-complete"], "Text", INPUTS],
  [["loading"], "Bool", ["button"]],
  [["multiple"], "Bool", ["input"]],
  [["value"], "Bool", ["check", "switch"]],
  [["selected"], "Bool", ["radio"]],
  [["options"], "Options", ["select"]],
  [["value", "min", "max", "step"], "Float", ["slider"]],
  [["auto-complete"], "Text", ["form"]],
  [["novalidate"], "Bool", ["form"]],
  [["level"], "Float", ["heading"]],
  [["external"], "Bool", ["link"]],
  [["controls", "autoplay"], "Bool", ["video"]],
  [["ordered"], "Bool", ["list"]],
  [["open"], "Bool", ["modal", "drawer", "popover", "details"]],
  [["value", "max"], "Float", ["progress"]],
];

/** `multiple` is allowed on a file input only (E0206). */
const BASE_ARGS: Record<string, string[]> = { input: [`type="file"`] };

const named = (tile: string, prop: string, value: string) =>
  `${tile}(${[...(BASE_ARGS[tile] ?? []), `${prop}=${value}`].join(", ")})`;

const block = (tile: string, prop: string, value: string) =>
  `${tile}(${(BASE_ARGS[tile] ?? []).join(", ")}) {${prop}: ${value}}`;

/** A value of another type, and the E0201 it draws. */
const WRONG: Record<PropType, [value: string, message: string]> = {
  Bool: [`"true"`, "E0201 Expected Bool but got Text"],
  Text: ["true", "E0201 Expected Text but got Bool"],
  Float: [`"2"`, "E0201 Expected Float but got Text"],
  Options: [`"a"`, "E0201 Expected List({label: Text, value}) but got Text"],
};

/** Values of the type: an `Int` is one of a `Float`. */
const RIGHT: Record<PropType, string[]> = {
  Bool: ["true", "n > 3"],
  Text: [`"x"`, "fruit"],
  Float: ["2", "2.5", "n"],
  Options: [`[{label: "A", value: "a"}]`, "opts"],
};

const cases = SPEC.flatMap(([props, type, tiles]) =>
  tiles.flatMap((tile) => props.map((prop) => ({ tile, prop, type }))),
);

describe.each(cases)("$tile $prop ($type)", ({ tile, prop, type }) => {
  const [value, message] = WRONG[type];

  it("is E0201 at a value of another type, as a named argument", () => {
    expect(E0201s(named(tile, prop, value))).toEqual([[message, `${value})`]]);
  });

  it("is E0201 at a value of another type, in the {…} block", () => {
    expect(E0201s(block(tile, prop, value))).toEqual([[message, `${value}}`]]);
  });

  it.each(RIGHT[type])("takes %s in either spelling", (good) => {
    expect(diagnostics(named(tile, prop, good))).toEqual([]);
    expect(diagnostics(block(tile, prop, good))).toEqual([]);
  });
});

describe("a typed prop written as an if, match or let", () => {
  it("is E0201 at the branch of another type", () => {
    const home = `button(disabled=if flag then true else "b")`;
    expect(E0201s(home)).toEqual([["E0201 Expected Bool but got Text", `"b")`]]);
  });
});

describe("select options", () => {
  const OPTION = "E0201 Expected {label: Text, value}";
  const OPTIONS = "E0201 Expected List({label: Text, value})";

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
    [
      "an entry branch that is no record",
      `select(options=[if flag then {label: "A", value: "a"} else "b"])`,
      [`"b"`],
    ],
    [
      "a literal branch's Text entry",
      `select(options=if flag then [{label: "A", value: "a"}] else ["x"])`,
      [`"x"`],
    ],
  ])("is E0201 at %s", (_, home, values) => {
    expect(E0201s(home)).toEqual(values.map((v) => [`${OPTION} but got Text`, from(home, v)]));
  });

  it.each([
    ["no value, which would write nothing when chosen", `{label: "A"}`, "{label: Text}"],
    ["no label, which would show nothing", `{value: "a"}`, "{value: Text}"],
    [
      "a label that is no Text",
      `{label: Some("x"), value: "a"}`,
      "{label: Option(Text), value: Text}",
    ],
    ["a record as its label", `{label: {a: 1}, value: "a"}`, "{label: {a: Int}, value: Text}"],
    ["a number as its label", `{label: 7, value: "a"}`, "{label: Int, value: Text}"],
  ])("is E0201 at a record entry with %s", (_, entry, actual) => {
    const home = `select(options=[${entry}])`;
    expect(E0201s(home)).toEqual([[`${OPTION} but got ${actual}`, from(home, entry)]]);
  });

  it.each([
    ["a list whose element is no option record", "select(options=names)", "names", "List(Text)"],
    ["a Set of option records", "select(options=picks)", "picks", "Set(Pick)"],
    [
      "an if branch that is such a list",
      "select(options=if flag then opts else names)",
      "names",
      "List(Text)",
    ],
    [
      "a match arm that is such a list",
      "select(options=match size with | S -> opts | L -> names)",
      "names",
      "List(Text)",
    ],
    ["the body of a let", "select(options=let o = names in o)", "o)", "List(Text)"],
  ])("is E0201 at %s", (_, home, value, actual) => {
    expect(E0201s(home)).toEqual([[`${OPTIONS} but got ${actual}`, from(home, value)]]);
  });

  it.each([
    ["a record with other fields too, which are not read", `[{label: "A", value: "a", hint: "x"}]`],
    ["a slot of such records", "wide"],
    ["a slot whose element type is an alias", "opts"],
    ["a slot whose list type is an alias", "aliased"],
    ["a fn's declared List of records", "sizes()"],
    ["values of a union", `[{label: "Any", value: None}, {label: "One", value: Some(1)}]`],
    ["branches that are each such a list", "if flag then opts else aliased"],
    ["the empty list", "[]"],
  ])("takes %s", (_, options) => {
    expect(diagnostics(`select(options=${options})`)).toEqual([]);
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
