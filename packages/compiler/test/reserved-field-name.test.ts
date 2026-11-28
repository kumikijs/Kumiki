import { describe, expect, it } from "vitest";
import {
  errorCodesOf,
  type Pointed,
  pointedErrorsOf,
  reservedFieldNameMessage,
} from "./helpers/diagnostics.ts";
import { withApp, withRoot } from "./helpers/programs.ts";

const reported = (text: string): Pointed => ({
  code: "E0240",
  message: reservedFieldNameMessage,
  text,
});

const LOAD = (inType: string) =>
  `effect load cap=storage.read in=${inType} out=Result(Text, Text) map-request={key: "k", decode: Decoder.Json(Text)}`;

// Each program writes one record field named `_tag`, and is refused there and nowhere else.
const WRITTEN: [where: string, src: string, text: string][] = [
  [
    "a type's record",
    withRoot(`text("x")`, "type R = {_tag: Text, n: Int}"),
    "_tag: Text, n: Int}",
  ],
  [
    "a union's payload",
    withRoot(`text("x")`, "type U = Box({_tag: Text}) | Empty"),
    "_tag: Text}) | Empty",
  ],
  [
    "a slot's type",
    withRoot(`text("x")`, "slot s : Option({_tag: Text}) = None"),
    "_tag: Text}) = None",
  ],
  [
    "a fn's parameter",
    withRoot(`text("x")`, "fn f(r: {_tag: Text}) -> Int = 1"),
    "_tag: Text}) -> Int = 1",
  ],
  [
    "a fn's result",
    withRoot(`text("x")`, "fn f() -> List({_tag: Text}) = []"),
    "_tag: Text}) = []",
  ],
  [
    "an effect's in=",
    withApp(`${LOAD("{k: Text, _tag: Text}")}\ntile App = column(text("x"))`, {
      caps: "storage.read",
    }),
    '_tag: Text} out=Result(Text, Text) map-request={key: "k", decode: Decoder.Json(Text)}',
  ],
  [
    "a tile's in=",
    withRoot(`text("x")`, "tile Card in={_tag: Text} = text($1._tag)"),
    "_tag: Text} = text($1._tag)",
  ],
  [
    "a record literal in a fn's body",
    withRoot(`text("x")`, 'fn f() -> Int = let r = {_tag="a", n=1} in r.n'),
    '_tag="a", n=1} in r.n',
  ],
  [
    "a record literal in a tile",
    withRoot('text({_tag="a", n=1}.n.show)', ""),
    '_tag="a", n=1}.n.show))',
  ],
];

describe("a record field named _tag is E0240", () => {
  it.each(WRITTEN)("in %s", (_, src, text) => {
    expect(pointedErrorsOf(src)).toEqual([reported(text)]);
  });

  it("refuses the issue's program at each of its four fields, and nothing else", () => {
    const src = withApp(`type R = {_tag: Text, n: Int}

slot pick : R = {_tag="a", n=2}

fn picks() -> List({label: Text, value: R})
   = [{label: "one", value: {_tag="a", n=1}},
      {label: "two", value: {_tag="a", n=2}}]

tile App = column(
             select(bind=pick, options=picks()) {id: "pick"},
             text("n: " + pick.n.show))`);
    expect(errorCodesOf(src)).toEqual(["E0240", "E0240", "E0240", "E0240"]);
  });

  it.each<[string, string]>([
    ["tag", 'type R = {tag: Text}\nslot r : R = {tag="a"}'],
    ["_tags", 'type R = {_tags: Text}\nslot r : R = {_tags="a"}'],
    ["_0", "type R = {_0: Int}\nslot r : R = {_0=1}"],
    ["_Tag", 'type R = {_Tag: Text}\nslot r : R = {_Tag="a"}'],
  ])("leaves a field named %s alone", (_, defs) => {
    expect(errorCodesOf(withRoot(`text("x")`, defs))).toEqual([]);
  });

  it("leaves a Map key spelled _tag alone, which is a value and not a field", () => {
    const src = withRoot(`text("x")`, 'slot m : Map(Text, Text) = {"_tag": "Some"}');
    expect(errorCodesOf(src)).toEqual([]);
  });
});

// A slot and an effect may be named `_tag`. A test section keyed by slot or effect names, and a
// test's `given` / `expect` keyed by section names, write a name there and build no record of it.
const testing = (test: string): string =>
  withApp(
    `slot _tag : Int = 0
slot r : {t: Text} = {t="a"}
effect _tag cap=storage.write in=Text out=Result(Unit, Text) map-request={key: "k", value: $1}
reducer bump on=ui.click(Bump) do= _tag := _tag + 1
reducer keep on=ui.click(Keep) do= emit _tag(_tag.show)
tile Bump = button(text="bump", onClick=bump)
tile Keep = button(text="keep", onClick=keep)
tile Card in={t: Text} = text($1.t)
tile App = column(text("n: " + _tag.show), Bump, Keep)
test t =
    ${test}`,
    { caps: "storage.write" },
  );

/** Each diagnostic's code and the text it points at. */
const pointsOf = (src: string): [code: string, text: string][] =>
  pointedErrorsOf(src).map((e) => [e.code, e.text]);

describe("a slot or an effect named _tag", () => {
  it.each<[where: string, test: string]>([
    [
      "a reducer-test's given.slots and expect.slots",
      `reducer-test bump
        given  = {slots: {_tag: 1}, event: {type: ui.click, target: Bump}}
        expect = {slots: {_tag: 2}, effects: []}`,
    ],
    [
      "a reducer-test's given.mocks",
      `reducer-test keep
        given  = {event: {type: ui.click, target: Keep}, mocks: {_tag: ok(())}}
        expect = {slots: {}, effects: [_tag("0")]}`,
    ],
    [
      "a property-test's given.slots",
      `property-test
        for-all   = {n: Int where between(0, 50)}
        given     = {slots: {_tag: n}, event: {type: ui.click, target: Bump}}
        invariant = run-reducer(bump).slots._tag == n + 1`,
    ],
    [
      "a tile-test's given.slots",
      `tile-test App
        given  = {slots: {_tag: 3}}
        expect = column(text("n: 3"), Bump, Keep)`,
    ],
    [
      "an episode-test's mocks and expect.slots-equal",
      `episode-test
        load   = "t.fixture.jsonl"
        mocks  = {_tag: from-log}
        expect = {slots-equal: {_tag: 2}, no-panics: true}`,
    ],
  ])("is a key, not a field, in %s", (_, test) => {
    expect(pointedErrorsOf(testing(test))).toEqual([]);
  });

  it.each<[where: string, test: string, points: [string, string][]]>([
    [
      "a field of a tile-test's given.in",
      `tile-test Card
        given  = {in: {_tag: "a", t: "b"}}
        expect = text("b")`,
      [
        ["E0215", '"a", t: "b"}}'],
        ["E0240", '_tag: "a", t: "b"}}'],
      ],
    ],
    [
      "a field of a record a slot is given",
      `reducer-test bump
        given  = {slots: {r: {_tag="x", t="b"}}, event: {type: ui.click, target: Bump}}
        expect = {slots: {_tag: 1}}`,
      [
        ["E0215", '"x", t="b"}}, event: {type: ui.click, target: Bump}}'],
        ["E0240", '_tag="x", t="b"}}, event: {type: ui.click, target: Bump}}'],
      ],
    ],
    [
      "a field of a given.event's payload",
      `reducer-test bump
        given  = {event: {type: ui.click, target: Bump, _tag: 1}}
        expect = {slots: {_tag: 1}}`,
      [["E0240", "_tag: 1}}"]],
    ],
  ])("leaves E0240 on %s", (_, test, points) => {
    expect(pointsOf(testing(test))).toEqual(points);
  });

  it.each<[where: string, test: string, points: [string, string][]]>([
    [
      "a slot given twice",
      `reducer-test bump
        given  = {slots: {_tag: 1, _tag: 2}, event: {type: ui.click, target: Bump}}
        expect = {slots: {_tag: 3}}`,
      [["E0008", "_tag: 2}, event: {type: ui.click, target: Bump}}"]],
    ],
    [
      "a section named _tag",
      `reducer-test bump
        given  = {_tag: 1, event: {type: ui.click, target: Bump}}
        expect = {slots: {_tag: 1}, _tag: 2}`,
      [
        ["E0714", "_tag: 1, event: {type: ui.click, target: Bump}}"],
        ["E0714", "_tag: 2}"],
      ],
    ],
  ])("leaves only the key's own error on %s", (_, test, points) => {
    expect(pointsOf(testing(test))).toEqual(points);
  });
});
