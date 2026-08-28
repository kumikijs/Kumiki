// The one setter both ways of writing a slot go through: the assignment a
// reducer lowers to (`_s.setPath`) and `bind=` write-back. A reducer's path can
// carry an index segment, which is an arbitrary runtime value — so the segments
// this has to survive are not only the ones a compiler emits deliberately.

import { _setPathHelper, bindLabel, type PathSegment } from "@kumikijs/runtime";
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
  // An index segment is `jsOfExpr(<the index expression>)` — whatever it
  // evaluates to. Terminating on `path.length` rather than on a `undefined`
  // head is what keeps one of those from being read as "path exhausted",
  // which would return the value in place of the whole slot.
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
    // Only `{get: true}` is the unwrap. An index that evaluates to an object
    // stringifies into a key, which is wrong but local — read as an unwrap it
    // would drop the segment and put the value where the container was.
    expect(_setPathHelper({ seed: { n: 0 } }, seg([{ x: 1 }]), { n: 7 })).toEqual({
      seed: { n: 0 },
      "[object Object]": { n: 7 },
    });
  });

  it("takes a numeric segment as a key", () => {
    expect(_setPathHelper({ 2: "a" }, seg([2]), "b")).toEqual({ 2: "b" });
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
    // `_stdlibCore.unwrap` unwraps `Some` / `Ok`, panics on `None` / `Err`, and
    // returns anything else unchanged — so `v.get.t` on a user variant reads
    // `v.t`, and this writes the same place. Descending into `_0` instead
    // would point the two sides at different fields, and would fabricate a
    // payload on a variant that has none.
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
  // Written into `data-kumiki-bind` by both renderers and reported on an
  // episode's `binds-updated`. Comparing the two renderers only says they
  // agree; this says what they agree ON — the source spelling, not the
  // encoding.
  it("spells an unwrap segment the way the source does", () => {
    expect(bindLabel("draft", [{ get: true }, "title"])).toBe("draft.get.title");
  });

  it("is the bind name alone when the path is empty or absent", () => {
    expect(bindLabel("note")).toBe("note");
    expect(bindLabel("note", [])).toBe("note");
  });
});
