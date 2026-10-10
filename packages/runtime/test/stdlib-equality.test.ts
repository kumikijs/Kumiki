import { describe, expect, it } from "vitest";
import { _stdlibCore } from "../src/stdlib.ts";

describe("value equality", () => {
  const { eq, contains, listUnique } = _stdlibCore;

  it("compares Lists, records, tuples, Maps and variant payloads by value", () => {
    expect(eq([], [])).toBe(true);
    expect(eq([1, [2, 3]], [1, [2, 3]])).toBe(true);
    expect(eq({ x: 1, y: 2 }, { y: 2, x: 1 })).toBe(true);
    expect(
      eq(
        { _tag: "Some", _0: { _tag: "Some", _0: 1 } },
        { _tag: "Some", _0: { _tag: "Some", _0: 1 } },
      ),
    ).toBe(true);
    expect(eq({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
  });

  it("tells different values apart", () => {
    expect(eq([1, 2], [2, 1])).toBe(false);
    expect(eq([1], [1, 1])).toBe(false);
    expect(eq({ x: 1, y: 2 }, { x: 1, y: 3 })).toBe(false);
    expect(eq({ a: undefined }, { b: undefined })).toBe(false);
    expect(eq({ _tag: "Some", _0: 1 }, { _tag: "None" })).toBe(false);
    expect(eq([1], { 0: 1 })).toBe(false);
    expect(eq(null, undefined)).toBe(false);
  });

  it("contains and listUnique ask eq's question, and contains on Text is a substring test", () => {
    const admin = () => ({ _tag: "Admin" });
    expect(contains([admin(), { _tag: "Editor" }], admin())).toBe(true);
    expect(contains([admin()], { _tag: "Viewer" })).toBe(false);
    expect(contains(null, 1)).toBe(false);
    expect(contains("kumiki", "mik")).toBe(true);
    expect(listUnique([admin(), admin(), { _tag: "Viewer" }, admin()])).toEqual([
      { _tag: "Admin" },
      { _tag: "Viewer" },
    ]);
    expect(listUnique([3, 1, 3, 2, 1])).toEqual([3, 1, 2]);
    expect(contains(["ab", "cd"], "b")).toBe(false);
    expect(contains(["ab", "cd"], "cd")).toBe(true);
  });

  it("compares Bytes byte by byte", () => {
    const { bytesFromText } = _stdlibCore;
    expect(eq(bytesFromText("abc"), bytesFromText("abc"))).toBe(true);
    expect(eq(bytesFromText("abc"), bytesFromText("abd"))).toBe(false);
    expect(eq(bytesFromText("ab"), bytesFromText("abc"))).toBe(false);
    expect(eq(bytesFromText("ab"), [97, 98])).toBe(false);
    expect(eq(bytesFromText("ab"), { 0: 97, 1: 98 })).toBe(false);
  });

  it.each([
    ["a Blob", () => new Blob(["aaa"]), () => new Blob(["bbb"])],
    ["a File", () => new File(["aaa"], "a.txt"), () => new File(["bbb"], "a.txt")],
    ["a Date", () => new Date(0), () => new Date(999)],
  ])("%s equals only itself", (_what, one, other) => {
    const a = one();
    expect(eq(a, a)).toBe(true);
    expect(eq(a, other())).toBe(false);
    expect(eq(a, one())).toBe(false);
  });

  it("keeps apart two picked files whose name, size and type agree", () => {
    const picked = (body: string) => {
      const file = new File([body], "a.txt", { type: "text/plain" });
      return { name: file.name, size: file.size, type: file.type, _file: file };
    };
    const a = picked("aaa");
    const b = picked("bbb");
    expect(eq(a, b)).toBe(false);
    expect(eq(a, a)).toBe(true);
    expect(listUnique([a, b, a])).toEqual([a, b]);
    expect(contains([a], b)).toBe(false);
  });

  it("answers a nullish or empty List with an empty List", () => {
    expect(listUnique(null)).toEqual([]);
    expect(listUnique(undefined)).toEqual([]);
    expect(listUnique([])).toEqual([]);
  });

  it("never finds NaN, the way == does not", () => {
    expect(eq(Number.NaN, Number.NaN)).toBe(false);
    expect(contains([Number.NaN], Number.NaN)).toBe(false);
    expect(listUnique([Number.NaN, 1, Number.NaN, 1])).toEqual([Number.NaN, 1, Number.NaN]);
    expect(listUnique([0, -0, "0", 0])).toEqual([0, "0"]);
  });
});
