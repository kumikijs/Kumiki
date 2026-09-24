// The result type of a member the receiver decides (stdlib.md §2.2).
//
// A flat name → type table cannot express a type built out of the receiver's
// own arguments, so `xs.head` on a `List(Int)` had no type and `n := xs.head`
// put an `Option(Int)` in a slot declared `Int`. Nothing reported it, and the
// readers disagree with what is in the slot from then on: `is-some` is false
// on a value that is there, and `match` finds no arm.
//
// The fix is one resolver, asked by both arms of `inferType` — so the two
// spellings of one member (`xs.head` is a `FieldAccess`, `xs.head()` a
// `MethodCall`) cannot answer differently, which is a property of the shape
// rather than something these tests have to police case by case.
//
// Two directions are pinned. `rejects` assigns the result into a slot of a
// deliberately wrong type, so E0201 means the type resolved at all. `accepts`
// assigns it into a slot of the type §2.2 gives it and asserts a clean
// program, which is what catches a *wrong* entry: resolving `tail` to an
// `Option` or `values` to a `List` of the key type would satisfy the first
// direction and report working programs.

import { check, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

const DECLS = `slot xs   : List(Int)         = []
slot ts   : List(Text)        = []
slot st   : Set(Int)          = []
slot m    : Map(Text, Int)    = {}
slot opt  : Option(Int)       = None
slot res  : Result(Int, Text) = Err("e")
slot txt  : Text              = ""
slot inst : Time              = Time.now
slot dur  : Duration          = Duration.s(1)`;

const DEFAULTS: Record<string, string> = {
  Text: '""',
  Int: "0",
  Float: "0.0",
  Bool: "false",
  "List(Int)": "[]",
  "List(Text)": "[]",
  "List(List(Int))": "[]",
  "List(Tuple(Text, Int))": "[]",
  "List(Tuple(Int, Int))": "[]",
  "Set(Int)": "[]",
  "Map(Text, Int)": "{}",
  "Option(Int)": "None",
  "Option(Float)": "None",
  "Result(Int, Text)": 'Err("e")',
};

const program = (body: string): string =>
  `${DECLS}
${body}
tile Btn = button(text="go")
tile App = column(Btn)
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []`;

/** `sink` is declared `<sinkType>`, and the expression is assigned into it. */
const withSink = (sinkType: string, expr: string): string =>
  program(`slot sink : ${sinkType} = ${DEFAULTS[sinkType]}
reducer act on=ui.click(Btn)
    do= sink := ${expr}`);

const codesOf = (src: string): string[] => check(parse(lex(src))).map((e) => e.code);

/** The member resolved to something, and that something is not `sinkType`. */
const rejects = (sinkType: string, expr: string): boolean =>
  codesOf(withSink(sinkType, expr)).includes("E0201");

/** The member resolved to exactly `sinkType` — nothing at all is reported. */
const accepts = (sinkType: string, expr: string): string[] => codesOf(withSink(sinkType, expr));

describe("a member whose result the receiver decides resolves to that result", () => {
  // Family 1 — a fixed `Bool`, whatever the receiver's arguments are.
  it.each([
    "xs.is-empty",
    "txt.is-empty",
    "opt.is-some",
    "opt.is-none",
    "res.is-ok",
    "res.is-err",
    'm.has("k")',
    "st.has(1)",
    "xs.contains(1)",
    'txt.contains("a")',
    'txt.starts-with("a")',
    'txt.ends-with("a")',
  ])("%s is a Bool", (expr) => {
    expect(rejects("Text", expr)).toBe(true);
  });

  // Family 2 — a fixed `Int`. `length` and `size` are not interchangeable:
  // §2.2.3 gives a List `length`, §2.2.1 and §2.2.2 give a Map and a Set
  // `size`. Each is asked of the receiver that declares it.
  it.each(["xs.length", "txt.length", "m.size", "st.size"])("%s is an Int", (expr) => {
    expect(rejects("Text", expr)).toBe(true);
  });

  // Family 3 — an `Option` built out of the receiver's own type argument,
  // which is the one a flat table cannot express at all.
  it.each([
    "xs.get(0)",
    "xs.head",
    "xs.last",
    "xs.find($1 > 1)",
  ])("%s is an Option(Int), not an Int", (expr) => {
    expect(rejects("Int", expr)).toBe(true);
  });

  it.each(["txt.parse-int", "txt.parse-float"])("%s is an Option, not a bare number", (expr) => {
    expect(rejects("Int", expr)).toBe(true);
  });

  // Family 4 — the receiver's own type back. `slice` and `remove` are the
  // cases that prove this has to be keyed by receiver rather than by name:
  // `slice` answers a `List` on a List and a `Text` on a Text, and `remove`
  // answers a Map on a Map and a Set on a Set.
  it.each([
    "xs.tail",
    "xs.reverse",
    "xs.sort",
    "xs.unique",
    "xs.push(1)",
    "xs.prepend(1)",
    "xs.concat(xs)",
    "xs.slice(0, 1)",
    "xs.filter($1 > 1)",
    "xs.sort-by($1)",
  ])("%s is a List(Int)", (expr) => {
    expect(rejects("Text", expr)).toBe(true);
  });

  it.each([
    'm.insert("k", 1)',
    'm.remove("k")',
    'm.update("k", $1 + 1)',
    "m.merge(m)",
    "m.filter($2 > 1)",
  ])("%s is a Map", (expr) => {
    expect(rejects("Text", expr)).toBe(true);
  });

  it.each([
    "st.add(1)",
    "st.remove(1)",
    "st.toggle(1)",
    "st.union(st)",
    "st.intersect(st)",
    "st.diff(st)",
  ])("%s is a Set", (expr) => {
    expect(rejects("Text", expr)).toBe(true);
  });

  it.each(["opt.or(opt)", "opt.filter($1 > 1)"])("%s is an Option(Int), not an Int", (expr) => {
    expect(rejects("Int", expr)).toBe(true);
  });

  it.each([
    "txt.upper",
    "txt.lower",
    "txt.trim",
    'txt.replace("a", "b")',
    "txt.slice(0, 1)",
  ])("%s is a Text", (expr) => {
    expect(rejects("Int", expr)).toBe(true);
  });

  // Family 5 — a container other than the receiver's own.
  it.each([
    "m.keys",
    "m.values",
    "m.entries",
    "st.to-list",
    "opt.to-list",
    'txt.split(",")',
    "xs.chunk(2)",
  ])("%s is a List", (expr) => {
    expect(rejects("Text", expr)).toBe(true);
  });

  it.each(['xs.join(",")'])("%s is a Text", (expr) => {
    expect(rejects("Int", expr)).toBe(true);
  });

  it.each(["res.to-option", "res.or(res)"])("%s is not the ok type", (expr) => {
    expect(rejects("Int", expr)).toBe(true);
  });

  it("res.get-err is the error type, not the ok type", () => {
    expect(rejects("Int", "res.get-err")).toBe(true);
  });
});

describe("every entry answers the exact type stdlib §2.2 gives it", () => {
  // The other direction, and the expensive one to get wrong: an entry that
  // resolves to the wrong type reports a program that works. Every member the
  // resolver answers for is here, assigned into a slot of its declared type.
  it.each([
    // Text (§2.2.6)
    ["Int", "txt.length"],
    ["Bool", "txt.is-empty"],
    ["Bool", 'txt.starts-with("a")'],
    ["Bool", 'txt.ends-with("a")'],
    ["Bool", 'txt.contains("a")'],
    ["Text", "txt.upper"],
    ["Text", "txt.lower"],
    ["Text", "txt.trim"],
    ["Text", 'txt.replace("a", "b")'],
    ["Text", "txt.slice(0, 1)"],
    ["List(Text)", 'txt.split(",")'],
    ["Option(Int)", "txt.parse-int"],
    ["Option(Float)", "txt.parse-float"],
    // Map (§2.2.1)
    ["Int", "m.size"],
    ["Bool", "m.is-empty"],
    ["Bool", 'm.has("k")'],
    ["List(Text)", "m.keys"],
    ["List(Int)", "m.values"],
    ["List(Tuple(Text, Int))", "m.entries"],
    ["Option(Int)", 'm.get("k")'],
    ["Map(Text, Int)", 'm.insert("k", 1)'],
    ["Map(Text, Int)", 'm.remove("k")'],
    ["Map(Text, Int)", 'm.update("k", $1 + 1)'],
    ["Map(Text, Int)", "m.merge(m)"],
    ["Map(Text, Int)", "m.filter($2 > 1)"],
    // Set (§2.2.2)
    ["Int", "st.size"],
    ["Bool", "st.has(1)"],
    ["Set(Int)", "st.add(1)"],
    ["Set(Int)", "st.remove(1)"],
    ["Set(Int)", "st.toggle(1)"],
    ["Set(Int)", "st.union(st)"],
    ["Set(Int)", "st.intersect(st)"],
    ["Set(Int)", "st.diff(st)"],
    ["List(Int)", "st.to-list"],
    // List (§2.2.3)
    ["Int", "xs.length"],
    ["Bool", "xs.is-empty"],
    ["Bool", "xs.contains(1)"],
    ["Option(Int)", "xs.get(0)"],
    ["Option(Int)", "xs.head"],
    ["Option(Int)", "xs.last"],
    ["Option(Int)", "xs.find($1 > 1)"],
    ["List(Int)", "xs.tail"],
    ["List(Int)", "xs.push(1)"],
    ["List(Int)", "xs.prepend(1)"],
    ["List(Int)", "xs.concat(xs)"],
    ["List(Int)", "xs.slice(0, 1)"],
    ["List(Int)", "xs.reverse"],
    ["List(Int)", "xs.sort"],
    ["List(Int)", "xs.sort-by($1)"],
    ["List(Int)", "xs.unique"],
    ["List(Int)", "xs.filter($1 > 1)"],
    ["Text", 'xs.join(",")'],
    ["List(List(Int))", "xs.chunk(2)"],
    // Option (§2.2.4)
    ["Bool", "opt.is-some"],
    ["Bool", "opt.is-none"],
    ["Int", "opt.get"],
    ["Option(Int)", "opt.filter($1 > 1)"],
    ["Option(Int)", "opt.or(opt)"],
    ["List(Int)", "opt.to-list"],
    // Result (§2.2.5)
    ["Bool", "res.is-ok"],
    ["Bool", "res.is-err"],
    ["Int", "res.get"],
    ["Text", "res.get-err"],
    ["Result(Int, Text)", "res.or(res)"],
    ["Option(Int)", "res.to-option"],
  ])("%s := %s is accepted", (sink, expr) => {
    expect(accepts(sink, expr)).toEqual([]);
  });
});

describe("the element type comes from the receiver, not from the member", () => {
  // A flat table could answer "List" but never "List of what". These pin the
  // argument being carried through, which is the whole point of resolving from
  // the receiver.
  it("m.keys is a List(Text) on a Map(Text, Int)", () => {
    expect(codesOf(withSink("List(Int)", "m.keys"))).toContain("E0201");
  });

  it("m.entries pairs the key type with the value type, in that order", () => {
    expect(codesOf(withSink("List(Tuple(Int, Int))", "m.entries"))).toContain("E0201");
  });

  it("ts.head is an Option(Text), so it does not fit an Option(Int) slot", () => {
    expect(codesOf(withSink("Option(Int)", "ts.head"))).toContain("E0201");
  });
});

describe("both spellings of an argument-less member answer the same type", () => {
  // `xs.head` parses as a FieldAccess and `xs.head()` as a MethodCall, and the
  // two are resolved by one function, so this is a property of the shape —
  // these cases pin that the shape is actually shared.
  it.each([
    ["Int", "xs.head"],
    ["Text", "xs.reverse"],
    ["Text", "m.keys"],
    ["Text", "opt.is-some"],
    ["Text", "xs.length"],
    ["Int", "txt.upper"],
  ])("%s := %s resolves the same with and without parentheses", (sink, expr) => {
    expect(rejects(sink, expr)).toBe(true);
    expect(rejects(sink, `${expr}()`)).toBe(true);
  });
});

describe("a decided result reaches a loop variable too", () => {
  // `for x in <expr>` binds the element type of whatever the expression
  // resolves to, so resolving these results reaches past assignment. The
  // accepting cases are the ones that matter: a wrong element type here
  // reports a loop body that runs.
  const inLoop = (body: string): string[] =>
    codesOf(
      program(`slot sink : Int = 0
reducer act on=ui.click(Btn)
    do= ${body}`),
    );

  it("binds the element of a filtered List", () => {
    expect(inLoop("for x in xs.filter($1 > 1) { sink := x }")).toEqual([]);
    expect(inLoop("for x in xs.filter($1 > 1) { sink := x.nope }")).toContain("E0108");
  });

  it("binds a Map's key type over .keys", () => {
    expect(inLoop("for k in m.keys { sink := k.length }")).toEqual([]);
    expect(inLoop("for k in m.keys { sink := k }")).toContain("E0201");
  });

  it("binds a Tuple of the key and value types over .entries", () => {
    expect(inLoop("for e in m.entries { sink := e }")).toContain("E0201");
  });

  it("binds a List over .chunk and a Text over .split", () => {
    expect(inLoop("for g in xs.chunk(2) { sink := g.length }")).toEqual([]);
    expect(inLoop('for p in txt.split(",") { sink := p.length }')).toEqual([]);
  });
});

describe("the receiver decides how many arguments .get takes", () => {
  // One name, two readings: `Map(K, V).get(k)` and `List(T).get(i)` against
  // `Option(T).get` and `Result(T, E).get`, which take none and unwrap. A
  // single minimum cannot state that, and the result type says nothing — a
  // count its receiver does not take resolves to nothing, and so is checked
  // against nothing.
  const messages = (expr: string): string[] =>
    check(parse(lex(withSink("Text", expr)))).map((e) => e.message);

  it("reports an argument passed to the unwrapping reading", () => {
    expect(codesOf(withSink("Text", "opt.get(1)"))).toEqual(["E0213"]);
    expect(messages("opt.get(1)")[0]).toContain('".get(key)" is the "Map" reading');
  });

  it("reports the unwrapping spelling on a keyed receiver", () => {
    expect(codesOf(withSink("Text", "m.get()"))).toEqual(["E0213"]);
    expect(codesOf(withSink("Text", "xs.get()"))).toEqual(["E0213"]);
    expect(messages("xs.get()")[0]).toContain("expects 1 argument (index)");
  });

  it("says nothing about the reading on an undecidable receiver, and still counts", () => {
    expect(codesOf(withSink("Text", "$event.get(1)"))).toEqual([]);
    expect(codesOf(withSink("Text", "$event.get(1, 2)"))).toEqual(["E0213"]);
  });

  it("accepts each reading written for its own receiver", () => {
    expect(accepts("Option(Int)", 'm.get("k")')).toEqual([]);
    expect(accepts("Option(Int)", "xs.get(0)")).toEqual([]);
    expect(accepts("Int", "opt.get")).toEqual([]);
    expect(accepts("Int", "res.get")).toEqual([]);
  });
});

describe("what stays undecidable", () => {
  // Nothing about the receiver is known, so nothing about the result is.
  it("says nothing about a member on an untyped receiver", () => {
    expect(codesOf(withSink("Text", "$event.head"))).toEqual([]);
  });

  // A lambda body decides these, not the receiver, so they are left alone
  // rather than resolved wrongly. `map` on a `List(Int)` is a `List(T')`, and
  // `T'` is whatever the expression says.
  it.each([
    "xs.map($1 + 1)",
    "xs.fold(0, $1 + $2)",
    "opt.flat-map(Some($1))",
  ])("%s stays undecidable, because a lambda decides it", (expr) => {
    expect(codesOf(withSink("Text", expr))).toEqual([]);
  });

  // `Time` (§2.2.8) and `Duration` (§2.2.9) are a family of their own: they
  // answer in each other's types rather than in a type argument, and
  // `Duration` is a nominal over `Int` rather than a prim.
  it.each([
    "dur.to-ms",
    'inst.format("yyyy")',
    "inst.diff(inst)",
  ])("%s stays undecidable, being another family", (expr) => {
    expect(codesOf(withSink("List(Int)", expr))).toEqual([]);
  });

  // `pow` has no result type even from a receiver — `2.pow(3)` is an Int and
  // `2.pow(-1)` is 0.5 (§2.2.7).
  it("pow stays undecidable", () => {
    expect(codesOf(withSink("Text", "xs.length.pow(2)"))).toEqual([]);
  });
});
