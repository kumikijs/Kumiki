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

  it("keeps every element of a key list `<` cannot order, and leaves the input alone", () => {
    const xs = keyed([3, "b", 1, { r: 1 }, "a"]);
    const out = _stdlibCore.listSortBy(xs, (x) => x.k);
    expect(ids(out).sort()).toEqual([0, 1, 2, 3, 4]);
    expect(ids(xs)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("listSort", () => {
  it("sorts a numeric list numerically, not lexicographically", () => {
    expect(_stdlibCore.listSort([3, 1, 2, 10])).toEqual([1, 2, 3, 10]);
    expect(_stdlibCore.listSort([])).toEqual([]);
    expect(_stdlibCore.listSort(null)).toEqual([]);
  });

  it("sorts a text list as strings", () => {
    expect(_stdlibCore.listSort(["banana", "apple", "cherry"])).toEqual([
      "apple",
      "banana",
      "cherry",
    ]);
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

  it("keys records by position, since every record shows alike", () => {
    // `show` is not injective for a record, so only the occurrence tells two apart.
    const keys = _stdlibCore.loopKeys([{ id: 2 }, { id: 1 }], "App_0");
    expect(keys).toEqual(["App_0|1|[object Object]", "App_0|2|[object Object]"]);
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
