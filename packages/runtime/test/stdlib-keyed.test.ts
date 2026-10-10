import { describe, expect, it } from "vitest";
import { KumikiPanic } from "../src/core.ts";
import { _stdlibCore } from "../src/stdlib.ts";

describe("keys read back as the declared key type", () => {
  const set = _stdlibCore.setAdd(_stdlibCore.setAdd({}, 7), 8);

  it("Set.to-list answers numbers for a numeric element", () => {
    expect(_stdlibCore.toList(set, "number")).toEqual([7, 8]);
  });

  it("Map.keys answers numbers for a numeric key", () => {
    expect(_stdlibCore.mapKeys({ 1: "a", 2: "b" }, "number")).toEqual([1, 2]);
  });

  it("Map.entries pairs a numeric key with its value", () => {
    expect(_stdlibCore.mapEntries({ 1: "a" }, "number")).toEqual([[1, "a"]]);
  });

  it("answers booleans for a Bool key", () => {
    const flags = _stdlibCore.setAdd(_stdlibCore.setAdd({}, true), false);
    expect(_stdlibCore.toList(flags, "bool")).toEqual([true, false]);
    expect(_stdlibCore.mapKeys({ true: 1 }, "bool")).toEqual([true]);
  });

  it("leaves a Text key a string, including one that looks like a number", () => {
    expect(_stdlibCore.mapKeys({ "7": 1, a: 2 })).toEqual(["7", "a"]);
    expect(_stdlibCore.toList(_stdlibCore.setAdd({}, "7"))).toEqual(["7"]);
  });

  it("Map.filter hands its predicate the restored key and keeps the entry under its stored key", () => {
    const seen: unknown[] = [];
    const pred = (pair: unknown) => {
      const [k] = pair as [unknown, unknown];
      seen.push(k);
      return k === 3;
    };
    expect(_stdlibCore.filter({ 3: "c", 4: "d" }, pred, "number")).toEqual({ 3: "c" });
    expect(seen).toEqual([3, 4]);
  });
});

describe(".size on a receiver only the runtime sees", () => {
  it("is the byte size of a File, not its key count", () => {
    const file = new File(["png"], "a.png", { type: "image/png" });
    const picked = { name: file.name, size: file.size, type: file.type, _file: file };
    expect(_stdlibCore.mapSize(picked)).toBe(3);
  });
});

describe("one key per value", () => {
  const s = _stdlibCore;
  const red = () => ({ _tag: "Red" });

  it("keeps distinct variants and records apart, and equal ones together", () => {
    const set = s.setAdd(s.setAdd({}, red()), { _tag: "Blue" });
    expect(s.setHas(set, red())).toBe(true);
    expect(s.setHas(set, { _tag: "Green" })).toBe(false);
    const m = s.mapInsert(s.mapInsert({}, { x: 0, y: 1 }, "a"), { y: 1, x: 0 }, "b");
    expect(s.mapSize(m)).toBe(1);
    expect(s.mapGet(m, { x: 0, y: 1 })).toBe("b");
    expect(s.index(m, { y: 1, x: 0 })).toBe("b");
  });

  it("removes the entry the other members stored, for any key type", () => {
    expect(s.mapRemove({ 1: "a", 2: "b" }, 1)).toEqual({ 2: "b" });
    expect(s.mapRemove(s.setAdd(s.setAdd({}, true), false), true)).toEqual({ false: true });
    expect(s.mapRemove(s.setAdd(s.setAdd({}, red()), { _tag: "Blue" }), red())).toEqual({
      '{"_tag":"Blue"}': true,
    });
    expect(s.mapRemove({ a: 1, b: 2 }, "a")).toEqual({ b: 2 });
  });

  it("reads a structured key back as the value it was written from", () => {
    const m = s.mapInsert({}, { y: 2, x: 1 }, 7);
    expect(s.mapKeys(m, "value")).toEqual([{ x: 1, y: 2 }]);
    expect(s.mapEntries(m, "value")).toEqual([[{ x: 1, y: 2 }, 7]]);
    expect(s.toList(s.setAdd({}, red()), "value")).toEqual([red()]);
  });

  it("panics, naming the key, on a structured key no member stored", () => {
    expect(() => s.mapKeys({ "[object Object]": 1 }, "value")).toThrow(KumikiPanic);
    expect(() => s.mapEntries({ Red: 1 }, "value")).toThrow(/"Red"/);
    expect(() => s.toList({ "[object Object]": true }, "value")).toThrow(
      /"\[object Object\]" was not stored by a Set or Map member/,
    );
  });
});

// Results are read with Object.keys / Object.entries, which list own keys only, so an own
// "__proto__" entry is told apart from the inherited accessor.
describe.each([
  "constructor",
  "toString",
  "valueOf",
  "hasOwnProperty",
  "__proto__",
])("a key spelled %j, like an Object.prototype member", (k) => {
  const s = _stdlibCore;

  it("is not held by an empty Map or Set", () => {
    expect(s.setHas({}, k)).toBe(false);
    expect(s.mapGet({}, k)).toBeUndefined();
    expect(s.mapGetOr({}, k, 0)).toBe(0);
    expect(Object.entries(s.mapUpdate({}, k, (v) => `${String(v)}!`))).toEqual([]);
    expect(() => s.index({}, k)).toThrow(KumikiPanic);
    expect(Object.keys(s.setToggle({}, k))).toEqual([k]);
    expect(Object.keys(s.setIntersect(s.setAdd({}, k), {}))).toEqual([]);
    expect(Object.keys(s.setDiff(s.setAdd({}, k), {}))).toEqual([k]);
    expect(Object.keys(s.diff(s.setAdd({}, k), {}) as object)).toEqual([k]);
  });

  it("reads back once written, and stays when another key is taken out", () => {
    const m = s.mapInsert(s.mapInsert({}, k, 1), "a", 2);
    expect(s.setHas(m, k)).toBe(true);
    expect(s.mapGet(m, k)).toBe(1);
    expect(s.mapGetOr(m, k, 0)).toBe(1);
    expect(s.index(m, k)).toBe(1);
    expect(Object.entries(s.mapUpdate(m, k, (v) => (v as number) + 1))).toEqual([
      [k, 2],
      ["a", 2],
    ]);
    expect(Object.entries(s.mapRemove(m, "a"))).toEqual([[k, 1]]);
    expect(Object.entries(s.mapRemove(m, k))).toEqual([["a", 2]]);

    const set = s.setAdd(s.setAdd({}, k), "a");
    expect(Object.keys(s.setToggle(set, "a"))).toEqual([k]);
    expect(Object.keys(s.setToggle(set, k))).toEqual(["a"]);
    expect(Object.keys(s.setIntersect(set, set))).toEqual([k, "a"]);
    expect(Object.keys(s.setDiff(set, s.setAdd({}, "a")))).toEqual([k]);
    expect(Object.keys(s.setUnion({}, set))).toEqual([k, "a"]);
  });

  it("is kept by Map.filter and Map.map", () => {
    const m = s.mapInsert(s.mapInsert({}, k, 1), "a", 2);
    expect(Object.entries(s.filter(m, () => true) as object)).toEqual([
      [k, 1],
      ["a", 2],
    ]);
    const plusOne = (pair: unknown) => (pair as [string, number])[1] + 1;
    expect(Object.entries(s.mapOver(m, plusOne) as object)).toEqual([
      [k, 2],
      ["a", 3],
    ]);
  });
});

describe("an index read", () => {
  it("reads the element of a List at the index", () => {
    expect(_stdlibCore.index([10, 20, 30], 1)).toBe(20);
  });

  it("panics for an index past the end or a negative one", () => {
    expect(() => _stdlibCore.index([10, 20, 30], 7)).toThrow(KumikiPanic);
    expect(() => _stdlibCore.index([10, 20, 30], 7)).toThrow(
      "Index 7 is out of range for a List of length 3",
    );
    expect(() => _stdlibCore.index([10, 20, 30], -1)).toThrow(KumikiPanic);
  });

  it("reads a Map entry by key, a numeric key included", () => {
    expect(_stdlibCore.index({ a: 1 }, "a")).toBe(1);
    expect(_stdlibCore.index({ 5: "x" }, 5)).toBe("x");
  });

  it("panics for a key the Map does not hold", () => {
    expect(() => _stdlibCore.index({ a: 1 }, "zz")).toThrow(KumikiPanic);
    expect(() => _stdlibCore.index({ a: 1 }, "zz")).toThrow('Key "zz" is not in the Map');
    expect(() => _stdlibCore.index({ 5: "x" }, 6)).toThrow("Key 6 is not in the Map");
  });

  it("shows a record key and a union key in their entry encoding", () => {
    expect(() => _stdlibCore.index({}, { y: 2, x: 1 })).toThrow(
      'Key {"x":1,"y":2} is not in the Map',
    );
    expect(() => _stdlibCore.index({}, { _tag: "Red" })).toThrow(
      'Key {"_tag":"Red"} is not in the Map',
    );
  });

  it("does not read an Object.prototype member as an entry", () => {
    expect(() => _stdlibCore.index({}, "toString")).toThrow(KumikiPanic);
  });
});

describe("mapOver on a Map", () => {
  it("hands the fragment one [key, value] argument, the key restored to its kind", () => {
    const calls: unknown[][] = [];
    const out = _stdlibCore.mapOver(
      { 3: "c", 4: "d" },
      (...args: unknown[]) => {
        calls.push(args);
        const [, v] = args[0] as [unknown, unknown];
        return `${String(v)}!`;
      },
      "number",
    );
    expect(calls).toEqual([[[3, "c"]], [[4, "d"]]]);
    expect(out).toEqual({ 3: "c!", 4: "d!" });
  });

  it("hands a two-element structured key whole, inside the pair", () => {
    const calls: unknown[][] = [];
    const out = _stdlibCore.mapOver(
      { "[1,2]": "a" },
      (...args: unknown[]) => {
        calls.push(args);
        return `${String((args[0] as [unknown, unknown])[1])}!`;
      },
      "value",
    );
    expect(calls).toEqual([[[[1, 2], "a"]]]);
    expect(out).toEqual({ "[1,2]": "a!" });
  });

  it('maps a Map that has a "_tag" key instead of returning it unchanged', () => {
    const out = _stdlibCore.mapOver(
      { _tag: "label", a: "x" },
      (pair) => `${String((pair as [unknown, unknown])[1])}!`,
    );
    expect(out).toEqual({ _tag: "label!", a: "x!" });
  });
});

describe("filter on an Option", () => {
  it("keeps a Some whose value passes the predicate", () => {
    const kept = _stdlibCore.filter(_stdlibCore.Some(3), (x) => (x as number) > 2);
    expect(kept).toEqual({ _tag: "Some", _0: 3 });
  });

  it("turns a Some whose value fails the predicate into None", () => {
    const dropped = _stdlibCore.filter(_stdlibCore.Some(3), (x) => (x as number) > 5);
    expect(dropped).toEqual({ _tag: "None" });
    expect(_stdlibCore.variantIs(dropped, "None")).toBe(true);
  });

  it("calls the predicate with the Option's value, not with its fields", () => {
    const seen: unknown[][] = [];
    _stdlibCore.filter(_stdlibCore.Some(3), (...args) => {
      seen.push(args);
      return true;
    });
    expect(seen).toEqual([[3]]);
  });

  it("leaves a None a None without calling the predicate", () => {
    let calls = 0;
    const out = _stdlibCore.filter(_stdlibCore.None, () => {
      calls++;
      return true;
    });
    expect(out).toEqual({ _tag: "None" });
    expect(calls).toBe(0);
  });

  it("still filters a Map entry-wise", () => {
    const pred = (pair: unknown) => (pair as [string, number])[1] > 1;
    expect(_stdlibCore.filter({ a: 1, b: 2 }, pred)).toEqual({ b: 2 });
  });
});
