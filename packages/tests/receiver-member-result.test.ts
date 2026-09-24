// A member whose result the receiver decides used to resolve to nothing, so
// an `Option(Int)` landed in an `Int` slot and a `Bool` in a `Text` slot with
// `check` saying `ok`. The value is then of a shape its readers do not expect:
// `is-some` is false on a value that is present, and a `match` finds no arm.
//
// The checker's own cases, family by family, are in
// `packages/compiler/test/receiver-member-result.test.ts`. What this file pins
// is that the two verbs agree — a program `check` rejects is one `build`
// refuses to emit — and that the idioms the corpus is built out of still
// compile, which is the half a rejection cannot show.

import { check, compile, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

const app = (defs: string): string =>
  `${defs}\ntile B = button(text="x")\ntile App = column(B)\napp A\n    caps   = []\n    routes = {"/" -> App, "/404" -> App}\n    init   = []`;

/** Three results, each written into a slot of another type. */
const WRONG_SLOT_WRITES = app(`slot xs  : List(Int)   = []
slot opt : Option(Int) = None
slot n   : Int         = 0
slot t   : Text        = ""
reducer a on=ui.click(B) do= n := xs.head
reducer b on=ui.click(B) do= t := opt.is-some
reducer c on=ui.click(B) do= n := xs.get(0)`);

describe("a receiver-decided result lands in a slot of its own type", () => {
  it("check reports all three writes", () => {
    const codes = check(parse(lex(WRONG_SLOT_WRITES))).map((e) => e.code);
    expect(codes.filter((c) => c === "E0201")).toHaveLength(3);
  });

  it("build refuses to emit it", () => {
    const r = compile(WRONG_SLOT_WRITES, { runtimeSpecifier: "./runtime.js" });
    expect(r.kind).toBe("fail");
    if (r.kind !== "fail") return;
    expect(r.errors.map((e) => e.code)).toContain("E0201");
  });

  // `.get` resolved for `Map` / `Option` / `Result` and not for `List`, though
  // §2.2 gives all four.
  it("reports .get on a List", () => {
    const src = app(`slot xs : List(Int) = []\nslot n : Int = 0
reducer a on=ui.click(B) do= n := xs.get(0)`);
    expect(check(parse(lex(src))).map((e) => e.code)).toContain("E0201");
  });
});

describe("what must keep compiling", () => {
  // Written the way the spec's own examples are, each result goes into a slot
  // of the type §2.2 gives it. Reporting any of these would be the expensive
  // direction — the corpus is built out of exactly these shapes.
  it.each([
    [
      "head into an Option",
      `slot xs : List(Int) = []\nslot o : Option(Int) = None`,
      "o := xs.head",
    ],
    [
      "get into an Option",
      `slot xs : List(Int) = []\nslot o : Option(Int) = None`,
      "o := xs.get(0)",
    ],
    [
      "keys into a List of the key type",
      `slot m : Map(Text, Int) = {}\nslot ks : List(Text) = []`,
      "ks := m.keys",
    ],
    [
      "values into a List of the value type",
      `slot m : Map(Text, Int) = {}\nslot vs : List(Int) = []`,
      "vs := m.values",
    ],
    ["sort into the same List", `slot xs : List(Int) = []`, "xs := xs.sort"],
    ["insert into the same Map", `slot m : Map(Text, Int) = {}`, 'm := m.insert("k", 1)'],
    ["to-list into a List", `slot s : Set(Int) = []\nslot xs : List(Int) = []`, "xs := s.to-list"],
    ["is-empty into a Bool", `slot xs : List(Int) = []\nslot b : Bool = false`, "b := xs.is-empty"],
    ["length into an Int", `slot xs : List(Int) = []\nslot n : Int = 0`, "n := xs.length"],
    [
      "the chained unwrap the spec leans on",
      `slot m : Map(Text, Int) = {}\nslot n : Int = 0`,
      'n := m.get("k").get-or(0)',
    ],
    [
      "find into an Option",
      `slot xs : List(Int) = []\nslot o : Option(Int) = None`,
      "o := xs.find($1 > 1)",
    ],
    [
      "the membership test the spec's own example is written as",
      `slot xs : List(Int) = []\nslot b : Bool = false`,
      "b := xs.find($1 > 1).is-some",
    ],
    [
      "the unwrapping .get, written without arguments",
      `slot o : Option(Int) = None\nslot n : Int = 0`,
      "n := o.get",
    ],
  ])("accepts %s", (_label, decls, body) => {
    const src = app(`${decls}\nreducer a on=ui.click(B) do= ${body}`);
    expect(check(parse(lex(src)))).toEqual([]);
  });

  it("still emits a program built from these shapes", () => {
    const src = app(`slot m : Map(Text, Int) = {}\nslot xs : List(Int) = []\nslot n : Int = 0
reducer a on=ui.click(B) do= n := m.get("k").get-or(xs.length)`);
    const r = compile(src, { runtimeSpecifier: "./runtime.js" });
    expect(r.kind).toBe("ok");
  });
});
