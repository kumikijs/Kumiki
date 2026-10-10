import { _stdlib, KumikiPanic } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";

const { Some, None, Ok, Err } = _stdlib;

describe("stdlib collection methods", () => {
  it("listChunk splits into n-sized chunks; the last may be shorter", () => {
    expect(_stdlib.listChunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(_stdlib.listChunk([], 2)).toEqual([]);
  });

  it("listZip pairs elements up to the shorter length", () => {
    expect(_stdlib.listZip([1, 2, 3], ["a", "b"])).toEqual([
      [1, "a"],
      [2, "b"],
    ]);
  });

  it("mapUpdate applies fn to an existing key and leaves an absent one alone", () => {
    expect(_stdlib.mapUpdate({ a: 1 }, "a", (v) => (v as number) + 1)).toEqual({ a: 2 });
    expect(_stdlib.mapUpdate({ a: 1 }, "b", (v) => (v as number) + 1)).toEqual({ a: 1 });
  });

  it("setAdd / setUnion / setIntersect / setDiff", () => {
    expect(_stdlib.setAdd({}, "x")).toEqual({ x: true });
    expect(_stdlib.setUnion({ a: true }, { b: true })).toEqual({ a: true, b: true });
    expect(_stdlib.setIntersect({ a: true, b: true }, { b: true, c: true })).toEqual({ b: true });
    expect(_stdlib.setDiff({ a: true, b: true }, { b: true })).toEqual({ a: true });
  });

  it.each([
    [Some(1), Some(2), Some(1)],
    [None, Some(2), Some(2)],
    [Ok(1), Ok(2), Ok(1)],
    [Err("e"), Ok(2), Ok(2)],
  ])("or(%j, %j) is %j", (receiver, other, result) => {
    expect(_stdlib.or(receiver, other)).toEqual(result);
  });

  it("mapErr maps the Err payload and passes Ok through", () => {
    expect(_stdlib.mapErr(Err("x"), (e) => `${e}!`)).toEqual(Err("x!"));
    expect(_stdlib.mapErr(Ok(1), (e) => `${e}!`)).toEqual(Ok(1));
  });

  it("diff is numeric for Time/Duration and set-difference for Sets", () => {
    expect(_stdlib.diff(10, 3)).toBe(7);
    expect(_stdlib.diff(3, 10)).toBe(7);
    expect(_stdlib.diff({ a: true, b: true }, { b: true })).toEqual({ a: true });
  });
});

describe("stdlib argument-less methods", () => {
  it("listHead / listLast return an Option, None when empty", () => {
    expect(_stdlib.listHead([1, 2, 3])).toEqual(Some(1));
    expect(_stdlib.listLast([1, 2, 3])).toEqual(Some(3));
    expect(_stdlib.listHead([])).toEqual(None);
    expect(_stdlib.listLast([])).toEqual(None);
    expect(_stdlib.listHead(null)).toEqual(None);
  });

  it.each([
    [
      [1, 2, 3],
      [2, 3],
    ],
    [[1], []],
    [[], []],
    [null, []],
  ])("listTail(%j) is %j", (list, tail) => {
    expect(_stdlib.listTail(list)).toEqual(tail);
  });

  it("toList: Option → [v]/[], Set → its keys, a list → a fresh copy", () => {
    expect(_stdlib.toList(Some(7))).toEqual([7]);
    expect(_stdlib.toList(None)).toEqual([]);
    expect(_stdlib.toList({ a: true, b: true })).toEqual(["a", "b"]);
    const src = [1, 2];
    const out = _stdlib.toList(src);
    expect(out).toEqual([1, 2]);
    expect(out).not.toBe(src);
  });

  it("toOption: Ok → Some, Err → None", () => {
    expect(_stdlib.toOption(Ok(5))).toEqual(Some(5));
    expect(_stdlib.toOption(Err("boom"))).toEqual(None);
  });

  it("getErr returns the Err payload and panics on Ok", () => {
    expect(_stdlib.getErr(Err("boom"))).toBe("boom");
    expect(() => _stdlib.getErr(Ok(1))).toThrow(KumikiPanic);
  });

  it("unwrap unwraps Some/Ok, panics on None/Err, and passes a plain value through", () => {
    expect(_stdlib.unwrap(Some(5))).toBe(5);
    expect(_stdlib.unwrap(Ok(7))).toBe(7);
    expect(() => _stdlib.unwrap(None)).toThrow(KumikiPanic);
    expect(() => _stdlib.unwrap(Err("x"))).toThrow(KumikiPanic);
    expect(_stdlib.unwrap(42)).toBe(42);
  });

  it("panic(msg) raises a KumikiPanic carrying the message", () => {
    expect(() => _stdlib.panic("boom")).toThrow(KumikiPanic);
    expect(() => _stdlib.panic("boom")).toThrow("boom");
  });

  it.each([
    ["parseIntOpt", "42", Some(42)],
    ["parseIntOpt", "3.7", Some(3)],
    ["parseIntOpt", "x", None],
    ["parseIntOpt", "", None],
    ["parseFloatOpt", "3.5", Some(3.5)],
    ["parseFloatOpt", "nope", None],
  ] as const)("%s(%j) is %j", (fn, text, result) => {
    expect(_stdlib[fn](text)).toEqual(result);
  });
});
