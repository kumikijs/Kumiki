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
