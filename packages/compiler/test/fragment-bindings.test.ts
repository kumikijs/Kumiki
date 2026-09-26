// Inside a fragment argument — `xs.map(…)`, `m.filter(…)` — `$1` / `$2` are
// bound to what the lowering hands the fragment, read off the receiver's type
// (stdlib.md §2.2): the element of a `List` or `Option`, the two halves of a
// `.entries` tuple, a Map's key and value, `fold`'s element. They used to be
// bound with no type at all, so nothing read through them was decided — which
// is how `rs.map($1.ids.to-list)` read a `Set(Int)`'s keys back as strings.
//
// Bound, they are checked like any other value. Where the lowering's reading
// is not certain the name stays untyped, because a wrong guess reports a
// working program.

import { check, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

const diagnostics = (defs: string, rhs: string, resType: string, init = "[]") =>
  check(
    parse(
      lex(`${defs}
slot res : ${resType} = ${init}
reducer act on=ui.click(Btn)
    do= res := ${rhs}
tile Btn = button(text="go")
tile App = column(Btn)
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []`),
    ),
  ).map((e) => `${e.code} ${e.message}`);

const LOUD = `fn loud(t: Text) -> Text = t + "!"`;

describe("$1 is the element a List hands its fragment", () => {
  it("reports an element passed where the fn wants another type", () => {
    const defs = `${LOUD}\nslot xs : List(Int) = [1, 2]`;
    expect(diagnostics(defs, "xs.map(loud($1))", "List(Text)")).toEqual([
      "E0201 Expected Text but got Int",
    ]);
  });

  it("accepts an element of the type the fn wants", () => {
    const defs = `${LOUD}\nslot xs : List(Text) = ["a"]`;
    expect(diagnostics(defs, "xs.map(loud($1))", "List(Text)")).toEqual([]);
  });

  it("binds the element to $2 of fold, and leaves the accumulator open", () => {
    const defs = `${LOUD}\nslot xs : List(Int) = [1, 2]`;
    expect(diagnostics(defs, `xs.fold("", loud($2))`, "Text", '""')).toEqual([
      "E0201 Expected Text but got Int",
    ]);
    expect(diagnostics(defs, "xs.fold(0, $1 + $2)", "Int", "0")).toEqual([]);
  });
});

describe("$1 / $2 are a Map's key and value, and the halves of an entry", () => {
  const KEEP = (k: string) => `fn keep(k: ${k}, v: Int) -> Bool = v > 0`;

  it("accepts a predicate over the key and value types", () => {
    const defs = `${KEEP("Text")}\nslot m : Map(Text, Int) = {}`;
    expect(diagnostics(defs, "m.filter(keep($1, $2))", "Map(Text, Int)", "{}")).toEqual([]);
  });

  it("reports a predicate whose key parameter is not the key type", () => {
    const defs = `${KEEP("Int")}\nslot m : Map(Text, Int) = {}`;
    expect(diagnostics(defs, "m.filter(keep($1, $2))", "Map(Text, Int)", "{}")).toEqual([
      "E0201 Expected Int but got Text",
    ]);
  });

  it("takes an entry apart the way the lowering does", () => {
    const defs = `${KEEP("Int")}\nslot m : Map(Text, Int) = {}`;
    expect(diagnostics(defs, "m.entries.filter(keep($1, $2))", "List(Tuple(Text, Int))")).toEqual([
      "E0201 Expected Int but got Text",
    ]);
  });
});

describe("where the lowering's reading is not certain, nothing is bound", () => {
  // The lowering takes any 2-element array apart, so an element that is a
  // `List` is not what `$1` holds when it has two items.
  it("an element that is itself a List", () => {
    const defs = `${LOUD}\nslot xss : List(List(Int)) = []`;
    expect(diagnostics(defs, "xss.map(loud($1))", "List(Text)")).not.toContain(
      "E0201 Expected Text but got List(Int)",
    );
  });

  // A `fn` with no `->` has no inferred result yet, so its elements are not
  // known here. That is a gap in inference, not a rule: once the result is
  // inferred this is the E0201 above, so only its absence today is pinned.
  it("a receiver whose type is not decided", () => {
    const defs = `${LOUD}\nfn anything(n: Int) = [n]`;
    expect(diagnostics(defs, "anything(1).map(loud($1))", "List(Text)")).not.toContain(
      "E0201 Expected Text but got Int",
    );
  });
});
