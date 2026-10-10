import { compile } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { checkSource, summariesOf } from "./helpers/diagnostics.ts";
import { withButtonApp } from "./helpers/programs.ts";

const errsOf = (defs: string, caps?: string) => checkSource(withButtonApp(defs, { caps }));
const diagnostics = (defs: string, caps?: string) => summariesOf(withButtonApp(defs, { caps }));

const SLOTS = `type UserId = nominal Text
type PostId = nominal Text
slot n    : Int        = 0
slot t    : Text       = ""
slot b    : Bool       = false
slot u    : UserId     = ""
slot p    : PostId     = ""
slot xs   : List(Int)  = []
slot name : Text       = ""
slot id   : EffectId   = EffectId.none`;

const inReducer = (body: string) => diagnostics(`${SLOTS}\nreducer r on=ui.click(B) do= ${body}`);

describe("a declared position checks a `let … in` at its body", () => {
  it("reports a fn body whose `let` yields the wrong type, at the body", () => {
    const line = "fn label(n: Int) -> Text = let m = n + 1 in m";
    const errs = errsOf(line);
    expect(errs.map((e) => [e.code, e.message, e.pos.line, e.pos.col])).toEqual([
      // 1-based: the `m` after `in `.
      ["E0201", "Expected Text but got Int", 1, line.lastIndexOf("m") + 1],
    ]);
  });

  it("reports a slot initialiser and an assignment", () => {
    expect(diagnostics(`slot k : Int = let y = "a" in y`)).toEqual([
      "E0201 Expected Int but got Text",
    ]);
    expect(inReducer(`n := let y = "a" in y`)).toEqual(["E0201 Expected Int but got Text"]);
  });

  it("reports an `emit` argument as E0202", () => {
    const defs = `effect e cap=log.write in=Int out=Result(Unit, Text)
reducer r on=ui.click(B) do= emit e(let y = "a" in y)`;
    expect(diagnostics(defs, "log.write")).toEqual(["E0202 Expected Int but got Text"]);
  });

  it.each([
    // [body, the text just before the value that lands in the `-> Text`]
    ["let a = n in let c = a + 1 in c", "a + 1 in "],
    [`let a = n in if a > 0 then a else "x"`, "then "],
    [`if n > 0 then let a = n in a else "x"`, "let a = n in "],
    [`let a = Some(n) in match a with | Some(v) -> v | None -> "x"`, "Some(v) -> "],
    [`match Some(n) with | Some(v) -> let w = v in w | None -> "x"`, "let w = v in "],
  ])("follows `%s` to the one value that does not fit", (body, before) => {
    const line = `fn f(n: Int) -> Text = ${body}`;
    expect(errsOf(line).map((e) => [e.code, e.message, e.pos.line, e.pos.col])).toEqual([
      ["E0201", "Expected Text but got Int", 1, line.indexOf(before) + before.length + 1],
    ]);
  });

  it("is refused by build as well as check", () => {
    const r = compile(withButtonApp("fn label(n: Int) -> Text = let m = n + 1 in m"), {
      runtimeSpecifier: "./runtime.js",
    });
    expect(r.kind).toBe("fail");
    if (r.kind !== "fail") return;
    expect(r.errors.map((e) => e.code)).toEqual(["E0201"]);
  });
});

describe("with no declared type, a `let … in` has its body's type", () => {
  // The plain form must report too, or a row would pass on a `let` that answers no type at all.
  it.each([
    ["a member the type lacks", `t := (let m = n in m).upper`, `t := n.upper`],
    ["a comparison across families", `b := (let m = t in m) < 1`, `b := t < 1`],
    ["a nominal comparison", `b := (let v = u in v) == p`, `b := u == p`],
    ["an arithmetic operand", `n := -(let m = t in m)`, `n := -t`],
    [
      "an `if` condition",
      `t := if (let c = n in c) then "a" else "b"`,
      `t := if n then "a" else "b"`,
    ],
    ["EffectId arithmetic", `n := (let i = id in i) + 1`, `n := id + 1`],
    [
      "a member's result in a declared position",
      `t := (let s = n.show in s).length`,
      `t := n.show.length`,
    ],
    [
      "an `if` branch joined with another",
      `let v = if b then (let w = u in w) else u; p := v`,
      `let v = if b then u else u; p := v`,
    ],
  ])("reports %s", (_, viaLet, plain) => {
    const expected = inReducer(plain);
    expect(expected).not.toEqual([]);
    expect(inReducer(viaLet)).toEqual(expected);
  });
});

describe("a name bound to an undecidable value", () => {
  // `.map` with a fragment answers no type, so `name` shadows the slot `name : Text` with none.
  it.each([
    ["by a `let … in`, in a declared position", `n := let name = xs.map($1) in name`],
    ["by a `let … in`, as a receiver", `n := (let name = xs.map($1) in name).upper`],
    ["by a `let` statement", `let name = xs.map($1); n := name`],
    ["by a `for`", `for name in xs.map($1) { n := name }`],
    ["by a match arm", `n := match xs.map($1).head with | Some(name) -> name | None -> 0`],
  ])("reports nothing when bound %s", (_, body) => {
    expect(inReducer(body)).toEqual([]);
  });
});

describe("a well-typed `let … in` still checks", () => {
  it.each([
    ["a fn body", `fn label(n: Int) -> Text = let m = n + 1 in m.show`],
    ["a nested `let`", `fn f(n: Int) -> Text = let a = n in let c = a + 1 in c.show`],
    [
      "an `if` of `let`s",
      `fn f(n: Int) -> Text = if n > 0 then let a = n in a.show else let c = "x" in c`,
    ],
    [
      "a `match` arm",
      `fn f(o: Option(Int)) -> Int = match o with | Some(v) -> let w = v in w + 1 | None -> 0`,
    ],
    ["a record value", `fn f(n: Int) -> Int = let r = {a: n} in r.a`],
    ["a list value", `fn f(n: Int) -> Int = let ys = [n] in ys.length`],
    ["an Option value", `fn f(n: Int) -> Int = let o = Some(n) in o.get-or(0)`],
    ["a param shadowed", `fn f(n: Int) -> Text = let n = "x" in n`],
    ["an Int body into a Float", `fn f(n: Int) -> Float = let m = n in m`],
    [
      "a slot shadowed",
      `slot k : Text = ""\nreducer r on=ui.click(B) do= k := let n = "a" in n\nslot n : Int = 0`,
    ],
    ["an assignment", `slot k : Int = 0\nreducer r on=ui.click(B) do= k := let y = k in y + 1`],
    ["an operand", `slot k : Int = 0\nreducer r on=ui.click(B) do= k := 1 + (let y = k in y)`],
    [
      "a member read off it",
      `slot k : Int = 0\nreducer r on=ui.click(B) do= k := (let s = k.show in s).length`,
    ],
    ["a tile's text", `slot k : Int = 0\ntile T = text(let m = k in m.show)`],
  ])("%s", (_, defs) => {
    expect(diagnostics(defs)).toEqual([]);
  });
});
