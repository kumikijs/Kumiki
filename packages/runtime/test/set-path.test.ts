import { _setPathHelper, bindLabel, KumikiPanic, type PathSegment } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";

/** Written as `unknown[]` where a case is deliberately outside the type. */
const seg = (xs: unknown[]): PathSegment[] => xs as PathSegment[];

describe("a field path", () => {
  it("sets a nested field, leaving the siblings", () => {
    expect(_setPathHelper({ a: { b: 1, c: 2 } }, ["a", "b"], 9)).toEqual({ a: { b: 9, c: 2 } });
  });

  it("replaces the whole value when the path is empty", () => {
    expect(_setPathHelper({ a: 1 }, [], "v")).toBe("v");
  });

  it("builds the missing levels of a path", () => {
    expect(_setPathHelper(undefined, ["a", "b"], 1)).toEqual({ a: { b: 1 } });
  });
});

describe("a segment that is not a field name", () => {
  it("takes an undefined index as a key, not as the end of the path", () => {
    expect(_setPathHelper({ seed: 0 }, seg([undefined]), 1)).toEqual({ seed: 0, undefined: 1 });
  });

  it("keeps walking past an undefined segment in the middle", () => {
    expect(_setPathHelper({ a: { b: 1 } }, seg(["a", undefined, "b"]), "V")).toEqual({
      a: { b: 1, undefined: { b: "V" } },
    });
  });

  it("does not read a null segment as an unwrap", () => {
    expect(_setPathHelper({ a: { b: 1 } }, seg(["a", null, "b"]), "V")).toEqual({
      a: { b: 1, null: { b: "V" } },
    });
  });

  it("does not read an arbitrary object segment as an unwrap", () => {
    expect(_setPathHelper({ seed: { n: 0 } }, seg([{ x: 1 }]), { n: 7 })).toEqual({
      seed: { n: 0 },
      '{"x":1}': { n: 7 },
    });
  });

  it("takes a numeric segment as a key", () => {
    expect(_setPathHelper({ 2: "a" }, seg([2]), "b")).toEqual({ 2: "b" });
  });
});

describe("an index into a List", () => {
  it("replaces the element at the index and leaves a List", () => {
    const out = _setPathHelper([1, 2, 3], [0], 7);
    expect(Array.isArray(out)).toBe(true);
    expect(out).toEqual([7, 2, 3]);
  });

  it("does not edit the list it was given", () => {
    const xs = [1, 2, 3];
    _setPathHelper(xs, [1], 9);
    expect(xs).toEqual([1, 2, 3]);
  });

  it("writes through the element at the index, keeping both levels a List and a record", () => {
    const out = _setPathHelper(
      {
        rows: [
          { n: 1, t: "a" },
          { n: 2, t: "b" },
        ],
      },
      ["rows", 1, "n"],
      9,
    );
    expect(out).toEqual({
      rows: [
        { n: 1, t: "a" },
        { n: 9, t: "b" },
      ],
    });
    expect(Array.isArray((out as { rows: unknown }).rows)).toBe(true);
  });

  it("reaches a List inside a List", () => {
    expect(
      _setPathHelper(
        [
          [1, 2],
          [3, 4],
        ],
        [1, 0],
        0,
      ),
    ).toEqual([
      [1, 2],
      [0, 4],
    ]);
  });
});

describe("an index that names no element of a List", () => {
  it("panics for an index past the end", () => {
    expect(() => _setPathHelper([1, 2, 3], [3], 7)).toThrow(KumikiPanic);
    expect(() => _setPathHelper([1, 2, 3], [3], 7)).toThrow(
      "Index 3 is out of range for a List of length 3",
    );
  });

  it("panics for an index past the end with more of the path behind it", () => {
    expect(() => _setPathHelper([{ n: 1 }], [5, "n"], 7)).toThrow(KumikiPanic);
  });

  it("panics for a negative index", () => {
    expect(() => _setPathHelper([1, 2, 3], [-1], 7)).toThrow(
      "Index -1 is out of range for a List of length 3",
    );
  });

  // The checker requires an `Int` for a List index, so these reach the setter
  // only through a value the types do not describe.
  it("panics for a number that is not a whole one", () => {
    expect(() => _setPathHelper([1, 2, 3], [0.5], 7)).toThrow(KumikiPanic);
    expect(() => _setPathHelper([1, 2, 3], seg([Number.NaN]), 7)).toThrow(KumikiPanic);
  });

  it("panics for a whole number spelled as text", () => {
    expect(() => _setPathHelper([1, 2, 3], seg(["0"]), 7)).toThrow(KumikiPanic);
  });
});

describe("an index that meets no List", () => {
  it("panics when the value is undefined or null", () => {
    expect(() => _setPathHelper(undefined, [0], 7)).toThrow(KumikiPanic);
    expect(() => _setPathHelper(null, [0], 7)).toThrow(KumikiPanic);
    expect(() => _setPathHelper({ doc: {} }, ["doc", "xs", 0], 7)).toThrow(KumikiPanic);
  });

  it("panics when the element to write through is missing", () => {
    expect(() => _setPathHelper({ rows: [{ n: 1 }, undefined] }, ["rows", 1, "n"], 9)).toThrow(
      KumikiPanic,
    );
  });
});

describe("an index into a Map", () => {
  it("writes the entry and leaves a plain object", () => {
    expect(_setPathHelper({ a: 1 }, ["b"], 2)).toEqual({ a: 1, b: 2 });
  });

  it("writes a field of an entry", () => {
    expect(_setPathHelper({ t1: { done: false, x: 1 } }, ["t1", "done"], true)).toEqual({
      t1: { done: true, x: 1 },
    });
  });

  it("inserts under a numeric key", () => {
    expect(_setPathHelper({}, [5], "x")).toEqual({ 5: "x" });
  });
});

describe("an index step", () => {
  const todos = { t1: { title: "a", done: false } };

  it("writes a field of the entry at a key the Map holds", () => {
    expect(_setPathHelper(todos, [{ at: "t1" }, "done"], true)).toEqual({
      t1: { title: "a", done: true },
    });
  });

  it("writes nothing through a key the Map does not hold", () => {
    expect(_setPathHelper(todos, [{ at: "t9" }, "done"], true)).toBe(todos);
  });

  it("does not take an Object.prototype member for an entry", () => {
    expect(_setPathHelper(todos, [{ at: "toString" }, "done"], true)).toBe(todos);
  });

  it("inserts or replaces the entry when it is the last step", () => {
    expect(_setPathHelper(todos, [{ at: "t9" }], { title: "b", done: true })).toEqual({
      ...todos,
      t9: { title: "b", done: true },
    });
    expect(_setPathHelper({}, [{ at: 5 }], "x")).toEqual({ 5: "x" });
  });

  it("indexes a List the way a bare numeric step does", () => {
    expect(_setPathHelper([{ n: 1 }, { n: 2 }], [{ at: 1 }, "n"], 9)).toEqual([{ n: 1 }, { n: 9 }]);
    expect(() => _setPathHelper([1, 2, 3], [{ at: 3 }], 7)).toThrow(
      "Index 3 is out of range for a List of length 3",
    );
  });

  it("takes a record key with `get: true` for a key, not an unwrap", () => {
    expect(_setPathHelper({}, [{ at: { get: true } }], 1)).toEqual({ '{"get":true}': 1 });
  });

  it("writes nothing through an absent outer key of a nested Map", () => {
    const grid = { x: { y: { n: 0 } } };
    expect(_setPathHelper(grid, [{ at: "a" }, { at: "b" }, "n"], 1)).toBe(grid);
    expect(_setPathHelper(grid, [{ at: "a" }, { at: "b" }], { n: 2 })).toBe(grid);
  });

  it("writes through a present outer key into the inner Map", () => {
    const grid = { a: {} };
    expect(_setPathHelper(grid, [{ at: "a" }, { at: "b" }, "n"], 1)).toEqual({ a: {} });
    expect(_setPathHelper(grid, [{ at: "a" }, { at: "b" }], { n: 2 })).toEqual({
      a: { b: { n: 2 } },
    });
  });

  it("writes through `.get` of the entry at a key the Map holds", () => {
    const opts = {
      a: { _tag: "Some", _0: { done: false } },
      b: { _tag: "None" },
    };
    expect(_setPathHelper(opts, [{ at: "a" }, { get: true }, "done"], true)).toEqual({
      ...opts,
      a: { _tag: "Some", _0: { done: true } },
    });
    expect(_setPathHelper(opts, [{ at: "b" }, { get: true }, "done"], true)).toEqual(opts);
    expect(_setPathHelper(opts, [{ at: "z" }, { get: true }, "done"], true)).toBe(opts);
  });

  it("leaves a field step building the level it finds missing", () => {
    expect(_setPathHelper({}, ["t9", "done"], true)).toEqual({ t9: { done: true } });
  });
});

describe("an unwrap segment", () => {
  it("edits the payload of a Some and leaves the tag", () => {
    expect(_setPathHelper({ _tag: "Some", _0: { t: "a" } }, [{ get: true }, "t"], "b")).toEqual({
      _tag: "Some",
      _0: { t: "b" },
    });
  });

  it("edits the payload of an Ok", () => {
    expect(_setPathHelper({ _tag: "Ok", _0: { t: "a" } }, [{ get: true }, "t"], "b")).toEqual({
      _tag: "Ok",
      _0: { t: "b" },
    });
  });

  it("skips a None and an Err, returning the value itself", () => {
    const none = { _tag: "None" };
    expect(_setPathHelper(none, [{ get: true }, "t"], "b")).toBe(none);
    const err = { _tag: "Err", _0: "boom" };
    expect(_setPathHelper(err, [{ get: true }, "t"], "b")).toBe(err);
  });

  it("passes a variant that is neither through, the way unwrap reads one", () => {
    expect(_setPathHelper({ _tag: "Loading" }, [{ get: true }, "t"], "b")).toEqual({
      _tag: "Loading",
      t: "b",
    });
    expect(_setPathHelper({ _tag: "Circle", _0: { r: 1 } }, [{ get: true }, "r"], 2)).toEqual({
      _tag: "Circle",
      _0: { r: 1 },
      r: 2,
    });
  });

  it("passes a plain value through", () => {
    expect(_setPathHelper({ t: "a" }, [{ get: true }, "t"], "b")).toEqual({ t: "b" });
  });
});

describe("the label a bind path renders as", () => {
  it("spells an unwrap segment the way the source does", () => {
    expect(bindLabel("draft", [{ get: true }, "title"])).toBe("draft.get.title");
  });

  it("is the bind name alone when the path is empty or absent", () => {
    expect(bindLabel("note")).toBe("note");
    expect(bindLabel("note", [])).toBe("note");
  });
});
