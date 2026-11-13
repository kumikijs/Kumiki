// A number literal is an `Int` or a `Float` by how it is written (language.md: `int` has no point,
// `float` has one), never by the number it is read as: `0.99999999999999999` is read as 1.

import { describe, expect, it } from "vitest";
import { pointedErrorsOf } from "./helpers/diagnostics.ts";
import { withButtonApp, withReducer } from "./helpers/programs.ts";

const FLOAT_INTO_INT = { code: "E0201", message: "Expected Int but got Float" };

describe("a literal written with a point", () => {
  it.each([
    "0.99999999999999999",
    "-0.99999999999999999",
    "1.0",
    "-1.0",
    "0.0",
    "9007199254740992.0",
    "9007199254740993.5",
  ])("is a Float, so %s where an Int is declared is E0201 at the literal", (literal) => {
    expect(pointedErrorsOf(withButtonApp(`slot n : Int = ${literal}`))).toEqual([
      { ...FLOAT_INTO_INT, text: literal },
    ]);
  });

  it.each([
    ["the body of a fn with no ->", `fn f() = 0.99999999999999999\nslot n : Int = f()`, "f()"],
    ["a let value", `slot n : Int = let x = 1.0 in x`, "x"],
    ["an operand of +", `fn f(i: Int) -> Int = i + 1.0`, "i + 1.0"],
    ["a list item", `slot xs : List(Int) = [1].concat([2.0])`, "2.0])"],
  ])("is a Float in %s, where no type is declared", (_, defs, text) => {
    expect(pointedErrorsOf(withButtonApp(defs))).toEqual([{ ...FLOAT_INTO_INT, text }]);
  });

  it("is a Float in a reducer write of an Int slot", () => {
    expect(pointedErrorsOf(withReducer(`slot n : Int = 0`, `n := 0.99999999999999999`))).toEqual([
      { ...FLOAT_INTO_INT, text: "0.99999999999999999" },
    ]);
  });

  it.each([
    "0.99999999999999999",
    "1.0",
    "9007199254740993.5",
  ])("is taken where a Float is declared: %s", (literal) => {
    expect(pointedErrorsOf(withButtonApp(`slot f : Float = ${literal}`))).toEqual([]);
  });
});

describe("a list literal of point-written items", () => {
  it("is a List(Float), so a List(Float) can start from one", () => {
    const prices = `slot prices : List(Float) = [2.5]\nslot xs : List(Float) = []`;
    expect(pointedErrorsOf(withReducer(prices, `xs := [0.0].concat(prices)`))).toEqual([]);
    expect(pointedErrorsOf(withReducer(prices, `xs := [0].concat(prices)`))).toEqual([
      {
        code: "E0201",
        message: "Expected List(Int) but got List(Float)",
        text: "prices)",
      },
    ]);
  });
});

describe("a literal written with no point", () => {
  it.each([
    "1",
    "-1",
    "0",
    "9007199254740991",
  ])("is an Int, taken where an Int or a Float is declared: %s", (literal) => {
    expect(
      pointedErrorsOf(withButtonApp(`slot n : Int = ${literal}\nslot f : Float = ${literal}`)),
    ).toEqual([]);
  });

  // 10^400 is past the largest double, so it is read as Infinity, which is no whole number.
  it.each([
    ["1", "Infinity"],
    ["-1", "-Infinity"],
  ])("is an Int even when it is read as no whole number: %s followed by 400 zeros", (lead, became) => {
    const literal = `${lead}${"0".repeat(400)}`;
    expect(pointedErrorsOf(withButtonApp(`slot n : Int = ${literal}`))).toEqual([
      {
        code: "E0217",
        message: `Int literal ${literal} is outside the safe range -9007199254740991 through 9007199254740991 and was rounded to ${became}`,
        text: literal,
      },
    ]);
  });
});
