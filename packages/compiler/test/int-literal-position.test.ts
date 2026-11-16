// An `Int` literal is an `Int` wherever it is written (language.md: `int` has no point), so where
// nothing declares a type it is the `Int` position E0217 holds to the safe range; only a position
// that declares another type, a `Float` say, makes it something else.

import { compile } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { errorsOf, pointedErrorsOf, textAt } from "./helpers/diagnostics.ts";
import { withButtonApp } from "./helpers/programs.ts";

const BIG = "9007199254740993";

/** Each error of `defs` in a program, as its code and the source text from where it is reported. */
const reported = (defs: string) =>
  pointedErrorsOf(withButtonApp(defs)).map(({ code, text }) => ({ code, text }));

const E0217_AT_BIG = { code: "E0217", text: expect.stringMatching(/^-?9007199254740993/) };

describe("an Int literal where no type is declared", () => {
  const ISSUE = `fn f(x: Int) = 9007199254740993
fn g(x: Int) -> Int = 9007199254740993
slot n : Int = 0
slot b : Bool = false
reducer r1 on=ui.click(B) do= n := let x = 9007199254740995 in x
reducer r2 on=ui.click(B) do= n := n + 9007199254740997
reducer r3 on=ui.click(B) do= b := n == 9007199254740999
reducer r4 on=ui.click(B) do= n := 9007199254741001`;

  it("is E0217 at the literal, as one where an Int is declared is: each line once", () => {
    const src = withButtonApp(ISSUE);
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
    const r = compile(withButtonApp(ISSUE), { runtimeSpecifier: "./runtime.js" });
    expect(r.kind).toBe("fail");
    if (r.kind !== "fail") return;
    expect(r.errors.map((e) => e.code)).toEqual(Array(6).fill("E0217"));
  });

  it.each([
    ["the body of a fn with no ->", `fn f(x: Int) = ${BIG}`],
    ["a let value", `fn f(x: Int) -> Int = let y = ${BIG} in x`],
    ["the left operand of +", `fn f(x: Int) -> Int = ${BIG} + x`],
    ["an operand of -", `fn f(x: Int) -> Int = x - ${BIG}`],
    ["an operand of *", `fn f(x: Int) -> Int = x * ${BIG}`],
    ["an operand of <", `fn f(x: Int) -> Bool = x < ${BIG}`],
    ["an operand of !=", `fn f(x: Int) -> Bool = x != ${BIG}`],
    ["an operand of + beside a Float", `fn f(x: Float) -> Float = x + ${BIG}`],
    ["a negative literal, at its sign", `fn f(x: Int) -> Int = x + -${BIG}`],
    ["the literal a second sign negates", `fn f() -> Int = - -${BIG}`],
    ["a match scrutinee", `fn f() -> Int = match ${BIG} with | _ -> 0`],
    ["an item of a list no type is declared for", `fn f() = [${BIG}]`],
    ["a receiver", `fn f() -> Text = ${BIG}.show`],
    ["a Map literal's key in a let", `fn f() -> Int = let m = {${BIG}: 1} in m.size`],
  ])("is E0217 in %s", (_, defs) => {
    expect(reported(defs)).toEqual([E0217_AT_BIG]);
  });

  it.each([
    `fn f(x: Int) = 9007199254740991`,
    `fn f(x: Int) -> Int = let y = -9007199254740991 in x + y`,
    `fn f(x: Int) -> Bool = x == 9007199254740991`,
  ])("takes a literal inside the safe range: %s", (defs) => {
    expect(reported(defs)).toEqual([]);
  });
});

describe("an Int literal a declared type also sees", () => {
  it.each([
    ["a fn body against its ->", `fn g(x: Int) -> Int = ${BIG}`],
    ["a slot", `slot n : Int = ${BIG}`],
    ["an if branch", `slot c : Bool = true\nfn g(c: Bool) -> Int = if c then ${BIG} else 0`],
    ["a let body", `fn g() -> Int = let y = 1 in ${BIG}`],
    ["a list item", `slot xs : List(Int) = [${BIG}]`],
    ["a Map literal's key", `slot m : Map(Int, Int) = {${BIG}: 1}`],
    ["a fn argument", `fn id(x: Int) -> Int = x\nslot n : Int = id(${BIG})`],
    ["a list index", `fn g(xs: List(Int)) -> Int = xs[${BIG}]`],
    ["a reducer write", `slot n : Int = 0\nreducer w on=ui.click(B) do= n := ${BIG}`],
    [
      "a member argument",
      `slot m : Map(Int, Int) = {}\nreducer w on=ui.click(B) do= m := m.insert(${BIG}, 1)`,
    ],
  ])("is one E0217 in %s, not two", (_, defs) => {
    expect(reported(defs)).toEqual([E0217_AT_BIG]);
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
});
