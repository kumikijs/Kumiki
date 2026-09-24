// The result type of a member the receiver decides (stdlib.md §2.2).
//
// `inferType` resolved three of them — `.get`, `.get-or` and `.copy` — as
// hand-written branches in the `MethodCall` arm, and everything else fell
// through to `METHOD_RESULT`, a flat name → prim table that cannot express a
// type built out of the receiver's own arguments. So `xs.head` on a
// `List(Int)` had no type, and `n := xs.head` put an `Option(Int)` in a slot
// declared `Int`. Nothing reported it, and the readers disagree with what is
// in the slot from then on: `is-some` is false on a value that is there, and
// `match` finds no arm.
//
// That is the same one-sided gap `.get-or` had. The fix is one resolver,
// `receiverMemberResult`, asked by both arms of `inferType` — so the two
// spellings of one member (`xs.head` is a `FieldAccess`, `xs.head()` a
// `MethodCall`) cannot answer differently, which is a property of the shape
// rather than something these tests have to police case by case.
//
// Each case below assigns the member's result into a slot of a deliberately
// wrong type. E0201 means the type resolved; silence means it did not.

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

/** `sink` is declared `<sinkType>`; the expression should not fit it. */
const withSink = (sinkType: string, expr: string): string =>
  `${DECLS}
slot sink : ${sinkType} = ${DEFAULTS[sinkType]}
reducer act on=ui.click(Btn)
    do= sink := ${expr}
tile Btn = button(text="go")
tile App = column(Btn)
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []`;

const DEFAULTS: Record<string, string> = {
  Text: '""',
  Int: "0",
  Bool: "false",
  "List(Int)": "[]",
  "Option(Int)": "None",
};

const codesOf = (src: string): string[] => check(parse(lex(src))).map((e) => e.code);

/** The member resolved to something, and that something is not `sinkType`. */
const resolves = (sinkType: string, expr: string): boolean =>
  codesOf(withSink(sinkType, expr)).includes("E0201");

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
    expect(resolves("Text", expr)).toBe(true);
  });

  // Family 2 — a fixed `Int`. `length` and `size` are not interchangeable:
  // §2.2.3 gives a List `length`, §2.2.1 and §2.2.2 give a Map and a Set
  // `size`. Each is asked of the receiver that declares it.
  it.each(["xs.length", "txt.length", "m.size", "st.size"])("%s is an Int", (expr) => {
    expect(resolves("Text", expr)).toBe(true);
  });

  // `Time` (§2.2.8) and `Duration` (§2.2.9) are outside the families this
  // change covers, and stay undecidable rather than being half-resolved.
  // `Duration` is a nominal over `Int` rather than a prim, so its members need
  // a different lookup than any receiver here.
  it.each([
    "dur.to-ms",
    'inst.format("yyyy")',
    "inst.diff(inst)",
  ])("%s stays undecidable, being outside this change", (expr) => {
    expect(codesOf(withSink("List(Int)", expr))).not.toContain("E0201");
  });

  // Family 3 — an `Option` built out of the receiver's own type argument. This
  // is the family the issue's repro is drawn from, and the one a flat table
  // cannot express at all.
  it.each([
    "xs.get(0)",
    "xs.head",
    "xs.last",
    "xs.find($1 > 1)",
  ])("%s is an Option(Int), not an Int", (expr) => {
    expect(resolves("Int", expr)).toBe(true);
  });

  it.each(["txt.parse-int", "txt.parse-float"])("%s is an Option, not a bare number", (expr) => {
    expect(resolves("Int", expr)).toBe(true);
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
    expect(resolves("Text", expr)).toBe(true);
  });

  it.each([
    'm.insert("k", 1)',
    'm.remove("k")',
    "m.merge(m)",
    "m.filter($2 > 1)",
  ])("%s is a Map", (expr) => {
    expect(resolves("Text", expr)).toBe(true);
  });

  it.each([
    "st.add(1)",
    "st.remove(1)",
    "st.toggle(1)",
    "st.union(st)",
    "st.diff(st)",
  ])("%s is a Set", (expr) => {
    expect(resolves("Text", expr)).toBe(true);
  });

  it.each(["opt.or(opt)", "opt.filter($1 > 1)"])("%s is an Option(Int), not an Int", (expr) => {
    expect(resolves("Int", expr)).toBe(true);
  });

  it.each([
    "txt.upper",
    "txt.lower",
    "txt.trim",
    'txt.replace("a", "b")',
    "txt.slice(0, 1)",
  ])("%s is a Text", (expr) => {
    expect(resolves("Int", expr)).toBe(true);
  });

  // Family 5 — a container other than the receiver's own.
  it.each([
    "m.keys",
    "m.values",
    "m.entries",
    "st.to-list",
    "opt.to-list",
    'txt.split(",")',
  ])("%s is a List", (expr) => {
    expect(resolves("Text", expr)).toBe(true);
  });

  it("res.to-option is an Option(Int), not an Int", () => {
    expect(resolves("Int", "res.to-option")).toBe(true);
  });

  it("res.get-err is the error type, not the ok type", () => {
    expect(resolves("Int", "res.get-err")).toBe(true);
  });
});

describe("the element type comes from the receiver, not from the member", () => {
  // A flat table could answer "List" but never "List of what". These pin the
  // argument being carried through, which is the whole point of resolving from
  // the receiver.
  it("m.keys is a List(Text) on a Map(Text, Int)", () => {
    expect(codesOf(withSink("List(Int)", "m.keys"))).toContain("E0201");
  });

  it("m.values is a List(Int), and fits a List(Int) slot", () => {
    expect(codesOf(withSink("List(Int)", "m.values"))).not.toContain("E0201");
  });

  it("st.to-list is a List(Int), and fits a List(Int) slot", () => {
    expect(codesOf(withSink("List(Int)", "st.to-list"))).not.toContain("E0201");
  });

  it("xs.head is an Option(Int), and fits an Option(Int) slot", () => {
    expect(codesOf(withSink("Option(Int)", "xs.head"))).not.toContain("E0201");
  });

  it("ts.head is an Option(Text), so it does not fit an Option(Int) slot", () => {
    expect(codesOf(withSink("Option(Int)", "ts.head"))).toContain("E0201");
  });
});

describe("both spellings of an argument-less member answer the same type", () => {
  // AC 2. `xs.head` parses as a FieldAccess and `xs.head()` as a MethodCall,
  // and the two used to be resolved by different code. One resolver serves
  // both now, so this is a property of the shape — these cases pin that the
  // shape is actually shared.
  it.each([
    ["Int", "xs.head"],
    ["Text", "xs.reverse"],
    ["Text", "m.keys"],
    ["Text", "opt.is-some"],
    ["Text", "xs.length"],
    ["Int", "txt.upper"],
  ])("%s := %s resolves the same with and without parentheses", (sink, expr) => {
    expect(resolves(sink, expr)).toBe(true);
    expect(resolves(sink, `${expr}()`)).toBe(true);
  });
});

describe("what stays undecidable", () => {
  // AC 3. Nothing about the receiver is known, so nothing about the result is.
  it("says nothing about a member on an untyped receiver", () => {
    expect(codesOf(withSink("Text", "$event.head"))).not.toContain("E0201");
  });

  it("says nothing about a member on a lambda parameter", () => {
    expect(codesOf(withSink("Text", "xs.map($1.head)"))).not.toContain("E0201");
  });

  // A lambda body decides these, not the receiver, so they are out of this
  // change rather than resolved wrongly. `map` on a `List(Int)` is a
  // `List(T')`, and `T'` is whatever the expression says.
  it.each([
    "xs.map($1 + 1)",
    "xs.fold(0, $1 + $2)",
    "opt.flat-map(Some($1))",
  ])("%s stays undecidable, because a lambda decides it", (expr) => {
    expect(codesOf(withSink("Text", expr))).not.toContain("E0201");
  });

  // `pow` has no result type even from a receiver — `2.pow(3)` is an Int and
  // `2.pow(-1)` is 0.5 (§2.2.7) — and this change does not invent one.
  it("pow stays undecidable", () => {
    expect(codesOf(withSink("Text", "xs.length.pow(2)"))).not.toContain("E0201");
  });
});
