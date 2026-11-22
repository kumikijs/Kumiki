// A number literal with no point, the grammar's `int`, is an `Int` where nothing declares a type for
// it (language.md), so there E0217 holds it to the safe range as it holds one where an `Int` is
// declared. Where another type is declared, that type judges the literal: a `Float` takes it, and a
// `Text` reports it as E0201.

import { compile } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { errorsOf, pointedCodesOf, textAt } from "./helpers/diagnostics.ts";
import { withButtonApp } from "./helpers/programs.ts";

const BIG = "9007199254740993";

/** Each error of `defs` in a program, as its code and the source text from where it is reported. */
const reported = (defs: string) => pointedCodesOf(withButtonApp(defs));

describe("an Int literal where no type is declared", () => {
  const UNDECLARED_POSITIONS = `fn f(x: Int) = 9007199254740993
fn g(x: Int) -> Int = 9007199254740993
slot n : Int = 0
slot b : Bool = false
reducer r1 on=ui.click(B) do= n := let x = 9007199254740995 in x
reducer r2 on=ui.click(B) do= n := n + 9007199254740997
reducer r3 on=ui.click(B) do= b := n == 9007199254740999
reducer r4 on=ui.click(B) do= n := 9007199254741001`;

  it("is E0217 at the literal, as one where an Int is declared is: each line once", () => {
    const src = withButtonApp(UNDECLARED_POSITIONS);
    const found = errorsOf(src)
      .map((e) => ({ code: e.code, line: e.pos.line, text: textAt(src, e.pos) }))
      .sort((a, b) => a.line - b.line);
    expect(found).toEqual([
      { code: "E0217", line: 1, text: "9007199254740993" },
      { code: "E0217", line: 2, text: "9007199254740993" },
      { code: "E0217", line: 5, text: "9007199254740995 in x" },
      { code: "E0217", line: 6, text: "9007199254740997" },
      { code: "E0217", line: 7, text: "9007199254740999" },
      { code: "E0217", line: 8, text: "9007199254741001" },
    ]);
  });

  it("refuses to build, so no rounded value is written out", () => {
    const r = compile(withButtonApp(UNDECLARED_POSITIONS), { runtimeSpecifier: "./runtime.js" });
    expect(r.kind).toBe("fail");
    if (r.kind !== "fail") return;
    expect(r.errors.map((e) => e.code)).toEqual(Array(6).fill("E0217"));
  });

  it.each([
    ["the body of a fn with no ->", `fn f(x: Int) = ${BIG}`, BIG],
    ["a let value", `fn f(x: Int) -> Int = let y = ${BIG} in x`, `${BIG} in x`],
    ["the left operand of +", `fn f(x: Int) -> Int = ${BIG} + x`, `${BIG} + x`],
    ["an operand of -", `fn f(x: Int) -> Int = x - ${BIG}`, BIG],
    ["an operand of *", `fn f(x: Int) -> Int = x * ${BIG}`, BIG],
    ["an operand of <", `fn f(x: Int) -> Bool = x < ${BIG}`, BIG],
    ["an operand of !=", `fn f(x: Int) -> Bool = x != ${BIG}`, BIG],
    ["an operand of + beside a Float", `fn f(x: Float) -> Float = x + ${BIG}`, BIG],
    ["a negative literal, at its sign", `fn f(x: Int) -> Int = x + -${BIG}`, `-${BIG}`],
    ["the literal a second sign negates", `fn f() = - -${BIG}`, `-${BIG}`],
    ["the literal a parenthesised sign negates", `fn f() = -(-${BIG})`, `-${BIG})`],
    ["a match scrutinee", `fn f() -> Int = match ${BIG} with | _ -> 0`, `${BIG} with | _ -> 0`],
    ["an item of a list no type is declared for", `fn f() = [${BIG}]`, `${BIG}]`],
    ["a receiver", `fn f() -> Text = ${BIG}.show`, `${BIG}.show`],
    [
      "a Map literal's key in a let",
      `fn f() -> Int = let m = {${BIG}: 1} in m.size`,
      `${BIG}: 1} in m.size`,
    ],
    ["an argument whose type nothing decides", `fn f() -> Bool = [].contains(${BIG})`, `${BIG})`],
  ])("is E0217 in %s", (_, defs, text) => {
    expect(reported(defs)).toEqual([{ code: "E0217", text }]);
  });

  it.each([
    `fn f(x: Int) = 9007199254740991`,
    `fn f(x: Int) -> Int = let y = -9007199254740991 in x + y`,
    `fn f(x: Int) -> Bool = x == 9007199254740991`,
  ])("takes a literal inside the safe range: %s", (defs) => {
    expect(reported(defs)).toEqual([]);
  });

  it.each([
    `fn f(x: Float) -> Float = x * 100000000000000000000.0`,
    `fn f() = 9007199254740992.0`,
    `fn f(x: Float) -> Float = let k = 9007199254740993.5 in x * k`,
    `fn f(x: Float) -> Float = x + -10000000000000000.0`,
  ])("takes a literal written with a point, which is no Int, past the safe range: %s", (defs) => {
    expect(reported(defs)).toEqual([]);
  });
});

describe("an Int literal a declared type also sees", () => {
  it.each([
    ["a fn body against its ->", `fn g(x: Int) -> Int = ${BIG}`, BIG],
    ["a slot", `slot n : Int = ${BIG}`, BIG],
    [
      "an if branch",
      `slot c : Bool = true\nfn g(c: Bool) -> Int = if c then ${BIG} else 0`,
      `${BIG} else 0`,
    ],
    ["a let body", `fn g() -> Int = let y = 1 in ${BIG}`, BIG],
    ["a list item", `slot xs : List(Int) = [${BIG}]`, `${BIG}]`],
    ["a Map literal's key", `slot m : Map(Int, Int) = {${BIG}: 1}`, `${BIG}: 1}`],
    ["a fn argument", `fn id(x: Int) -> Int = x\nslot n : Int = id(${BIG})`, `${BIG})`],
    ["a list index", `fn g(xs: List(Int)) -> Int = xs[${BIG}]`, `${BIG}]`],
    ["a reducer write", `slot n : Int = 0\nreducer w on=ui.click(B) do= n := ${BIG}`, BIG],
    [
      "a member argument",
      `slot m : Map(Int, Int) = {}\nreducer w on=ui.click(B) do= m := m.insert(${BIG}, 1)`,
      `${BIG}, 1)`,
    ],
  ])("is one E0217 in %s, not two", (_, defs, text) => {
    expect(reported(defs)).toEqual([{ code: "E0217", text }]);
  });

  it.each([
    ["a Float slot", `slot f : Float = ${BIG}`],
    ["a fn body against -> Float", `fn h() -> Float = ${BIG}`],
    ["a List(Float) item", `slot fs : List(Float) = [${BIG}]`],
    ["a Float fn argument", `fn half(x: Float) -> Float = x / 2\nslot f : Float = half(${BIG})`],
  ])("is a Float where one is declared, and is taken there: %s", (_, defs) => {
    expect(reported(defs)).toEqual([]);
  });

  it("is reported by what the declared type makes of it: E0201 where a Text is declared", () => {
    expect(reported(`slot t : Text = ${BIG}`)).toEqual([{ code: "E0201", text: BIG }]);
  });

  it.each([
    [`slot n : Int = -(-${BIG})`, [{ code: "E0217", text: `-${BIG})` }]],
    [`slot f : Float = - -${BIG}`, []],
    [`slot f : Float = -(-${BIG})`, []],
    [`slot t : Text = - -${BIG}`, [{ code: "E0201", text: `- -${BIG}` }]],
    [`slot t : Text = -(-${BIG})`, [{ code: "E0201", text: `-(-${BIG})` }]],
  ])("is judged under a second sign by the declared type, once: %s", (defs, expected) => {
    expect(reported(defs)).toEqual(expected);
  });

  it.each([
    ["a slot", `slot x : Nope = ${BIG}`, `Nope = ${BIG}`],
    ["an Option payload", `slot o : Option(Nope) = Some(${BIG})`, `Nope) = Some(${BIG})`],
    ["an alias", `type A = Nope\nslot x : A = ${BIG}`, "Nope"],
  ])("is E0117 alone in %s whose declared type names nothing", (_, defs, text) => {
    expect(reported(defs)).toEqual([{ code: "E0117", text }]);
  });
});
