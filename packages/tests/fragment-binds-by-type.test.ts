// A `filter` / `map` / `find` / `sort-by` fragment binds `$1` / `$2` from the
// receiver's type (stdlib.md §2.2.3). The lowering used to decide at run time,
// taking apart any value that was an array of exactly two items — so a
// two-item `List` element or `Option(List)` value bound `$1` to its first item,
// and the answer depended on the list's length. Each row goes through check,
// codegen and the runtime, which is where the binding is made: a unit test on
// the stdlib helpers never reaches it.

import { check, lex, parse } from "@kumikijs/compiler";
import { mount } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { loadSource } from "./helpers/load.ts";

const program = (slotDefs: string, resType: string, rhs: string): string => `${slotDefs}
slot res : ${resType} = ${resType.startsWith("Option") ? "None" : resType.startsWith("List") ? "[]" : resType === "Text" ? '""' : "0"}
reducer run on=ui.click(Run) do= res := ${rhs}
tile Run = button(text="run", onClick=run)
tile App = column(Run)
app M caps=[] routes={"/" -> App, "/404" -> App} init=[]`;

/** Check, build and mount `source`, click `run` once, and return `res`. */
async function run(source: string): Promise<unknown> {
  expect(codes(source)).toEqual([]);
  const app = await loadSource(source);
  const root = document.createElement("div");
  document.body.appendChild(root);
  try {
    const { dispose } = mount(app, root);
    root.querySelector("button")?.click();
    const res = app.live?.res;
    dispose();
    return res;
  } finally {
    root.remove();
  }
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
  // The same two-item shape in one program: an `.entries` pair and a Map's
  // filter are taken apart, a `List(Int)` element is not.
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
      `E0103 "$2" is not bound here — the .${method} fragment is handed one value, "$1"; "$2" is bound only over a Map's filter or a pair (Tuple(A, B), e.g. from .entries)`,
    ]);
  });
});

describe("an element that is itself a Set is typed", () => {
  // With `$1` bound to the element whole, the checker types it, so a key
  // reader on it restores the keys (stdlib.md §2.2.2).
  it("reads a Set element's keys back as Int", async () => {
    const source = program(
      "slot tags : Set(Int) = {}",
      "List(List(Int))",
      "[tags.add(3)].map($1.to-list)",
    );
    expect(await run(source)).toEqual([[3]]);
  });
});
