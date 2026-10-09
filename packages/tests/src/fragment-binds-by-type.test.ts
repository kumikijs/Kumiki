import { check, lex, parse } from "@kumikijs/compiler";
import { mount } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { withRoot } from "./helpers/dom.ts";
import { loadSource } from "./helpers/load.ts";
import { withApp } from "./helpers/source.ts";

const program = (slotDefs: string, resType: string, rhs: string): string =>
  withApp(`${slotDefs}
slot res : ${resType} = ${resType.startsWith("Option") ? "None" : resType.startsWith("List") ? "[]" : resType === "Text" ? '""' : "0"}
reducer run on=ui.click(Run) do= res := ${rhs}
tile Run = button(text="run", onClick=run)
tile App = column(Run)`);

/** Check, build and mount `source`, click `run` once, and return `res`. */
async function run(source: string): Promise<unknown> {
  expect(codes(source)).toEqual([]);
  const app = await loadSource(source);
  return withRoot(async (root) => {
    const { dispose } = mount(app, root);
    root.querySelector("button")?.click();
    const res = app.live?.res;
    dispose();
    return res;
  });
}

function codes(source: string): string[] {
  return check(parse(lex(source)))
    .filter((e) => e.severity !== "warning")
    .map((e) => `${e.code} ${e.message}`);
}

const PAIR = "slot pair : Option(List(Int)) = Some([1, 2])";
const NESTED = "slot nested : List(List(Int)) = [[1, 2], [3, 4, 5]]";

describe("a two-item list is one value to the fragment", () => {
  it.each([
    ["pair.filter($1.length > 1)", PAIR, "Option(List(Int))", { _tag: "Some", _0: [1, 2] }],
    ["pair.map($1.length)", PAIR, "Option(Int)", { _tag: "Some", _0: 2 }],
    ["nested.filter($1.length > 1).length", NESTED, "Int", 2],
    ["nested.map($1.length)", NESTED, "List(Int)", [2, 3]],
    ["nested.find($1.length == 2)", NESTED, "Option(List(Int))", { _tag: "Some", _0: [1, 2] }],
    [
      "nested.sort-by(0 - $1.length)",
      NESTED,
      "List(List(Int))",
      [
        [3, 4, 5],
        [1, 2],
      ],
    ],
  ])("%s", async (rhs, defs, resType, want) => {
    expect(await run(program(defs, resType, rhs))).toEqual(want);
  });
});

describe("the type, not the length, decides", () => {
  it("takes a pair apart and hands a two-item list over whole", async () => {
    const defs = `slot scores : Map(Text, Int) = {"ann": 2, "bob": 1}
${NESTED}`;
    const rhs =
      'scores.entries.sort-by($2).map($1).join(",") + "|" + scores.filter($1 == "ann" && $2 == 2).size.show + "|" + nested.map($1.length).show';
    expect(await run(program(defs, "Text", rhs))).toBe("bob,ann|1|2,3");
  });
});

describe("a fragment handed one value binds no second positional", () => {
  it.each([
    [
      "an Option predicate",
      "slot o : Option(Int) = Some(7)",
      "Option(Int)",
      "o.filter($2 > 5)",
      "filter",
    ],
    ["a List element lambda", "slot xs : List(Int) = [1]", "List(Int)", "xs.map($2)", "map"],
  ])("reports the second positional in %s", (_what, defs, resType, rhs, method) => {
    expect(codes(program(defs, resType, rhs))).toEqual([
      `E0103 "$2" is not bound here — the .${method} fragment is handed one value, "$1"; "$2" is bound only over a Map's filter or map, or a pair (Tuple(A, B), e.g. from .entries)`,
    ]);
  });
});

describe("an element that is itself a Set is typed", () => {
  it("reads a Set element's keys back as Int", async () => {
    const source = program(
      "slot tags : Set(Int) = {}",
      "List(List(Int))",
      "[tags.add(3)].map($1.to-list)",
    );
    expect(await run(source)).toEqual([[3]]);
  });
});

describe("a bare fn fragment binds like the call it stands for", () => {
  it("hands a two-item list element whole to a named fn", async () => {
    const defs = `fn len(xs: List(Int)) -> Int = xs.length
${NESTED}`;
    expect(await run(program(defs, "List(Int)", "nested.map(len)"))).toEqual([2, 3]);
  });
});

describe("a Set's filter is handed its elements", () => {
  it("keeps the Text elements the predicate keeps", async () => {
    const defs = 'slot words : Set(Text) = ["ann", "bob"]';
    expect(await run(program(defs, "List(Text)", 'words.filter($1 != "bob").to-list'))).toEqual([
      "ann",
    ]);
  });
  it("keeps the Int elements the predicate keeps", async () => {
    const defs = "slot tags : Set(Int) = [1, 2, 3]";
    expect(await run(program(defs, "Int", "tags.filter($1 > 1).size"))).toBe(2);
  });
});

describe("a $2 inside another method's argument is the enclosing fragment's", () => {
  const NUMS =
    'slot nums : List(Int) = [1, 2]\nslot words : List(Text) = ["a", "b"]\nslot m : Map(Text, Int) = {"a": 9}';
  it.each([
    ["nums.map($1.min($2))", "List(Int)", "map"],
    ['words.map($1.replace("a", $2))', "List(Text)", "map"],
    ['nums.map(m.get-or("zz", $2))', "List(Int)", "map"],
    ["nums.map(nums.push($2).length)", "List(Int)", "map"],
    ['words.map(m.update("a", $2).size)', "List(Int)", "map"],
  ])("reports %s", (rhs, resType, method) => {
    expect(codes(program(NUMS, resType, rhs))).toEqual([
      `E0103 "$2" is not bound here — the .${method} fragment is handed one value, "$1"; "$2" is bound only over a Map's filter or map, or a pair (Tuple(A, B), e.g. from .entries)`,
    ]);
  });
  it("reads an enclosing pair's value from inside a one-positional fragment", async () => {
    const defs = 'slot scores : Map(Text, Int) = {"ann": 2, "bob": 1}';
    const rhs = "scores.entries.map(scores.update($1, $1 + $2).get-or($1, 0))";
    expect(await run(program(defs, "List(Int)", rhs))).toEqual([4, 2]);
  });
});

describe("a fn named as a two-positional fragment where only one is bound", () => {
  const ADD2 = "fn add2(a: Int, b: Int) -> Int = a + b";
  it.each([
    ["an Option", "slot picked : Option(Int) = Some(1)", "picked.map(add2)"],
    ["a Result", "slot parsed : Result(Int, Text) = Ok(1)", "parsed.map(add2)"],
    ["a List(Int)", "slot xs : List(Int) = [1]", "xs.map(add2)"],
  ])("reports E0213 over %s", (_what, defs, rhs) => {
    const found = codes(program(`${ADD2}\n${defs}`, "Int", rhs)).map((c) => c.slice(0, 5));
    expect(found).toContain("E0213");
  });

  it.each([
    ["a record", "type P = { x: Int }\nslot p : P = { x: 1 }", "p.map(add2)"],
    ["Text", 'slot t : Text = "x"', "t.map(add2)"],
    ["an Option", "slot picked : Option(Int) = Some(1)", "picked.sort-by(add2)"],
    ["a Result", "slot parsed : Result(Int, Text) = Ok(1)", "parsed.filter(add2)"],
  ])("reports only E0108 over %s, which lacks the member", (_what, defs, rhs) => {
    const found = codes(program(`${ADD2}\n${defs}`, "Int", rhs)).map((c) => c.slice(0, 5));
    expect(found).toEqual(["E0108"]);
  });
});

describe("the shapes a fragment takes apart", () => {
  it.each([
    [
      "an Option holding a pair is taken apart (map)",
      "slot o : Option(Tuple(Int, Int)) = Some((1, 2))",
      "Option(Int)",
      "o.map($1 + $2)",
      { _tag: "Some", _0: 3 },
    ],
    [
      "an Option holding a pair is taken apart (filter)",
      "slot o : Option(Tuple(Int, Int)) = Some((1, 2))",
      "Int",
      "o.filter($2 > $1).map($1 * 10 + $2).get-or(0)",
      12,
    ],
    [
      "a Result's Ok value is one value",
      "slot r : Result(List(Int), Text) = Ok([1, 2])",
      "Int",
      "r.map($1.length).get-or(0)",
      2,
    ],
    [
      "a List of pairs is taken apart (filter, find)",
      'slot scores : Map(Text, Int) = {"ann": 2, "bob": 1}',
      "Text",
      'scores.entries.filter($2 > 1).map($1).join(",") + "|" + scores.entries.find($2 == 1).map($1).get-or("")',
      "ann|bob",
    ],
    [
      "an aliased pair is a pair",
      "type Pair = Tuple(Int, Int)\nslot ps : List(Pair) = [(1, 2), (3, 4)]",
      "List(Int)",
      "ps.map($1 + $2)",
      [3, 7],
    ],
  ])("%s", async (_what, defs, resType, rhs, want) => {
    expect(await run(program(defs, resType, rhs))).toEqual(want);
  });
});

describe("a Map's map is handed each entry, the key and the value", () => {
  const M = "slot m : Map(Int, Int) = {1: 10, 2: 20}";
  const shown = (mapped: string) => `${mapped}.entries.map($1.show + "=" + $2.show).join(",")`;
  it.each([
    ["a fragment over $1 and $2", "", "m.map($1 * 100 + $2)", "1=110,2=220"],
    ["a fn of two", "fn add2(k: Int, v: Int) -> Int = k + v", "m.map(add2)", "1=11,2=22"],
    [
      "a fn of one, given the key",
      "fn keyOnly(k: Int) -> Int = k * 3",
      "m.map(keyOnly)",
      "1=3,2=6",
    ],
  ])("%s", async (_what, fns, mapped, want) => {
    expect(await run(program(`${fns}\n${M}`, "Text", shown(mapped)))).toBe(want);
  });
});

describe("a fn's own $2 inside a fragment handed one value", () => {
  it("says the fragment hides it and how to reach it", () => {
    const defs = "fn addK(xs: List(Int), k: Int) -> List(Int) = xs.map($1 + $2)";
    expect(codes(program(defs, "Int", "0"))).toEqual([
      `E0103 "$2" is not bound here — the .map fragment is handed one value, "$1", and its positionals hide the enclosing "$2": refer to that value by its name`,
    ]);
  });
});
