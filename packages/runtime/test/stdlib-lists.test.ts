import { describe, expect, it } from "vitest";
import { _stdlibCore } from "../src/stdlib.ts";

describe("listSortBy", () => {
  const users = [
    { name: "carol", age: 30 },
    { name: "alice", age: 20 },
    { name: "bob", age: 25 },
    { name: "abe", age: 20 },
  ];
  const names = (xs: { name: string }[]) => xs.map((u) => u.name);

  it("orders a Text key as `<` orders two Texts", () => {
    expect(names(_stdlibCore.listSortBy(users, (u) => u.name))).toEqual([
      "abe",
      "alice",
      "bob",
      "carol",
    ]);
  });

  it("orders a numeric key numerically, keeping equal keys in their order", () => {
    expect(names(_stdlibCore.listSortBy(users, (u) => u.age))).toEqual([
      "alice",
      "abe",
      "bob",
      "carol",
    ]);
    expect(_stdlibCore.listSortBy([10, 9, 100], (x) => x)).toEqual([9, 10, 100]);
  });

  // A key the checker could not type arrives as whatever it is at runtime.
  const keyed = (ks: unknown[]) => ks.map((k, i) => ({ id: i, k }));
  const ids = (xs: { id: number }[]) => xs.map((x) => x.id);

  it("sorts an absent (undefined) key after every other, keeping its order", () => {
    expect(ids(_stdlibCore.listSortBy(keyed([3, undefined, 1, null, 2]), (x) => x.k))).toEqual([
      2, 4, 0, 1, 3,
    ]);
    expect(
      ids(_stdlibCore.listSortBy(keyed([undefined, undefined, undefined]), (x) => x.k)),
    ).toEqual([0, 1, 2]);
  });

  it("sorts a NaN key after every other, keeping its order", () => {
    expect(
      ids(_stdlibCore.listSortBy(keyed(["b", Number.NaN, "a", Number.NaN]), (x) => x.k)),
    ).toEqual([2, 0, 1, 3]);
  });

  it("orders a numeric key that arrives as Text the way `<` does", () => {
    expect(_stdlibCore.listSortBy(["9", "10"], (x) => x)).toEqual(["10", "9"]);
    expect(_stdlibCore.listSortBy([10, "9", 2], (x) => x)).toEqual([2, "9", 10]);
  });

  it("keeps an undefined element in its order among null and NaN when it is its own key", () => {
    expect(_stdlibCore.listSortBy([undefined, Number.NaN, 2, null, 1], (x) => x)).toStrictEqual([
      1,
      2,
      undefined,
      Number.NaN,
      null,
    ]);
  });

  it("keeps every element of a key list `<` cannot order, and leaves the input alone", () => {
    const xs = keyed([3, "b", 1, { r: 1 }, "a"]);
    const out = _stdlibCore.listSortBy(xs, (x) => x.k);
    expect(ids(out).sort()).toEqual([0, 1, 2, 3, 4]);
    expect(ids(xs)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("listSort", () => {
  const { NaN: nan, POSITIVE_INFINITY: inf, NEGATIVE_INFINITY: ninf } = Number;

  it.each<[string, unknown[] | null, unknown[]]>([
    ["a numeric list numerically, not lexicographically", [3, 1, 2, 10], [1, 2, 3, 10]],
    ["an empty list as empty", [], []],
    ["a nullish list as empty", null, []],
    ["Infinity after every finite number", [10, 9, 1.5, inf], [1.5, 9, 10, inf]],
    ["-Infinity before every finite number", [10, ninf, 9, 1.5], [ninf, 1.5, 9, 10]],
    [
      "NaN after every other number, Infinity included",
      [nan, 10, 9, inf, nan, ninf, 1.5],
      [ninf, 1.5, 9, 10, inf, nan, nan],
    ],
    [
      "the numbers of a list holding null numerically, null last",
      [10, 9, null, 1.5],
      [1.5, 9, 10, null],
    ],
    [
      "the numbers of a list holding undefined numerically, undefined last",
      [10, undefined, 9, 1.5],
      [1.5, 9, 10, undefined],
    ],
    [
      "absent values and NaN last, in the order they had",
      [undefined, nan, 2, null, 1],
      [1, 2, undefined, nan, null],
    ],
    ["a text list as strings", ["banana", "apple", "cherry"], ["apple", "banana", "cherry"]],
    ["text that spells a number as text", ["9", "10"], ["10", "9"]],
    ["text in UTF-16 code-unit order, not a locale's", ["a", "Z"], ["Z", "a"]],
    [
      "the text of a list holding null as text, null last",
      ["b", null, "a", "nullx"],
      ["a", "b", "nullx", null],
    ],
    ["a list mixing numbers and text with null last", ["z", null, 1], [1, "z", null]],
  ])("sorts %s", (_, input, expected) => {
    expect(_stdlibCore.listSort(input)).toStrictEqual(expected);
  });

  // `sort-by` over records keyed by the values, so that it sees each value only as a key.
  const sortedAsKeys = (ks: unknown[]) =>
    _stdlibCore
      .listSortBy(
        ks.map((k) => ({ k })),
        (r) => r.k,
      )
      .map((r) => r.k);

  it.each<[string, unknown[]]>([
    ["numbers, infinities and NaN", [nan, 10, 2, inf, -0.5, ninf, 2]],
    ["numbers and null", [10, 9, null, 1.5]],
    ["numbers and undefined", [10, undefined, 9, 1.5]],
    ["numbers, NaN, null and undefined", [undefined, 3, nan, null, 1]],
    ["text and null", ["b", null, "a", "nullx"]],
  ])("orders %s as sort-by orders the same values as keys", (_, xs) => {
    expect(_stdlibCore.listSort(xs)).toStrictEqual(sortedAsKeys(xs));
  });

  it("orders a list mixing numbers and text by each value's text, unlike sort-by", () => {
    const xs = [10, "9", 2];
    expect(_stdlibCore.listSort(xs)).toStrictEqual([10, 2, "9"]);
    expect(sortedAsKeys(xs)).toStrictEqual([2, "9", 10]);
  });

  it("does not mutate the input list", () => {
    const xs = [3, 1, 2];
    _stdlibCore.listSort(xs);
    expect(xs).toEqual([3, 1, 2]);
  });
});

describe("listFind", () => {
  it("wraps a hit in Some, so is-some reads true", () => {
    const hit = _stdlibCore.listFind([3, 1, 2], (x) => x > 2);
    expect(hit).toEqual({ _tag: "Some", _0: 3 });
    expect(_stdlibCore.variantIs(hit, "Some")).toBe(true);
  });

  it("answers None on a miss, rather than undefined", () => {
    const miss = _stdlibCore.listFind([3, 1, 2], (x) => x > 99);
    expect(miss).toEqual({ _tag: "None" });
    expect(_stdlibCore.variantIs(miss, "Some")).toBe(false);
    expect(_stdlibCore.variantIs(miss, "None")).toBe(true);
  });

  it("treats a nullish list as empty rather than throwing", () => {
    expect(_stdlibCore.listFind(undefined as unknown as number[], () => true)).toEqual({
      _tag: "None",
    });
  });
});

describe("loopKeys", () => {
  it("keys equal values apart by their occurrence", () => {
    const keys = _stdlibCore.loopKeys([7, 3, 7], "App_0");
    expect(new Set(keys).size).toBe(3);
    expect(keys).toEqual(["App_0|1|7", "App_0|1|3", "App_0|2|7"]);
  });

  it("keys two loops' shared value apart by the loop", () => {
    expect(_stdlibCore.loopKeys([2], "App_0")).not.toEqual(_stdlibCore.loopKeys([2], "App_1"));
  });

  it("keeps a value's key when the list is reordered", () => {
    const before = _stdlibCore.loopKeys(["a", "b", "c"], "App_0");
    const after = _stdlibCore.loopKeys(["c", "a", "b"], "App_0");
    expect(after).toEqual([before[2], before[0], before[1]]);
  });

  it("cannot be spelled by another element's value", () => {
    expect(new Set(_stdlibCore.loopKeys(["x", "x", "2|x", "1|2|x"], "App_0")).size).toBe(4);
  });

  it("keys records, Maps and Sets by position, whatever they hold", () => {
    const keys = _stdlibCore.loopKeys([{ id: 2 }, { id: 1 }], "App_0");
    expect(keys).toEqual(["App_0|1|", "App_0|2|"]);
    expect(_stdlibCore.loopKeys([{ id: 1 }, { id: 2 }], "App_0")).toEqual(keys);
    expect(_stdlibCore.loopKeys([{ id: 1, done: true }, { id: 2 }], "App_0")).toEqual(keys);
  });

  it("keys a List element and a variant by what they show", () => {
    expect(_stdlibCore.loopKeys([[1, 2], { _tag: "Some", _0: 3 }], "App_0")).toEqual([
      "App_0|1|[1, 2]",
      "App_0|1|Some",
    ]);
  });
});

describe("isEmpty's scalar tail", () => {
  it("a missing value is empty", () => {
    expect(_stdlibCore.isEmpty(undefined)).toBe(true);
    expect(_stdlibCore.isEmpty(null)).toBe(true);
  });

  it("any other scalar is not empty, zero and false included", () => {
    expect(_stdlibCore.isEmpty(0)).toBe(false);
    expect(_stdlibCore.isEmpty(7)).toBe(false);
    expect(_stdlibCore.isEmpty(false)).toBe(false);
  });
});
