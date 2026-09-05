// Issue #92: Bytes constructors live in `_stdlibCore` and are reached via
// codegen-emitted `_s.bytesFrom*` calls. The unit test pins the byte-level
// behavior of each constructor so a regression in the runtime helper surfaces
// here even if the compiler's smoke / examples test happens to skip the path.

import { describe, expect, it } from "vitest";
import { _stdlibCore } from "../src/stdlib.ts";

describe("Bytes constructors (docs/spec/stdlib.md §2.1.1 / §2.2.10)", () => {
  it("bytesFromText UTF-8 encodes the string", () => {
    expect(_stdlibCore.bytesFromText("hi")).toEqual(new Uint8Array([0x68, 0x69]));
    expect(_stdlibCore.bytesFromText("")).toEqual(new Uint8Array([]));
    // multi-byte (Japanese "あ" → E3 81 82)
    expect(_stdlibCore.bytesFromText("あ")).toEqual(new Uint8Array([0xe3, 0x81, 0x82]));
  });

  it("bytesFromText coerces nullish to empty without throwing", () => {
    expect(_stdlibCore.bytesFromText(null)).toEqual(new Uint8Array([]));
    expect(_stdlibCore.bytesFromText(undefined)).toEqual(new Uint8Array([]));
  });

  it("bytesFromBase64 decodes standard base64", () => {
    // "hi" → "aGk="
    expect(_stdlibCore.bytesFromBase64("aGk=")).toEqual(new Uint8Array([0x68, 0x69]));
    expect(_stdlibCore.bytesFromBase64("")).toEqual(new Uint8Array([]));
  });

  it("bytesFromBase64 returns an empty Uint8Array for malformed / nullish input (does not throw)", () => {
    expect(_stdlibCore.bytesFromBase64(null)).toEqual(new Uint8Array([]));
    expect(_stdlibCore.bytesFromBase64(undefined)).toEqual(new Uint8Array([]));
    // `!` is not a valid base64 character; native atob would throw a DOMException.
    expect(_stdlibCore.bytesFromBase64("!!!not base64!!!")).toEqual(new Uint8Array([]));
  });

  it("bytesFromBytes accepts a List(Int) and clamps to the low 8 bits", () => {
    expect(_stdlibCore.bytesFromBytes([1, 2, 3])).toEqual(new Uint8Array([1, 2, 3]));
    // 256 wraps to 0, 257 to 1 — same as `& 0xff`.
    expect(_stdlibCore.bytesFromBytes([1, 2, 256, 257])).toEqual(new Uint8Array([1, 2, 0, 1]));
    expect(_stdlibCore.bytesFromBytes([])).toEqual(new Uint8Array([]));
  });

  it("bytesFromBytes falls back to an empty Uint8Array for non-list input", () => {
    expect(_stdlibCore.bytesFromBytes(null)).toEqual(new Uint8Array([]));
    expect(_stdlibCore.bytesFromBytes(undefined)).toEqual(new Uint8Array([]));
  });
});

// Issue #92 review: previously `.sort()` lowered inline to JS's default
// (string-comparator) sort, so `[3,1,2,10].sort` → `[1,10,2,3]` for a
// `List(Int)`. The fix routes both forms through `_stdlibCore.listSort`
// which sorts numerically when every element is a finite number.
describe("listSort (docs/spec/stdlib.md §2.2.3 List.sort)", () => {
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

// Issue #340: `fmt` had no helper at all, so codegen's `_s.fmt ? … : template`
// guard always took the else branch and every call returned its template with
// the placeholders intact. The rules pinned here are the ones docs/spec/stdlib.md
// §2.4.5 now states — including the two it used to leave open.
describe("fmt (docs/spec/stdlib.md §2.4.5)", () => {
  it("replaces each {n} with the argument at that index", () => {
    expect(_stdlibCore.fmt("{0}-{1}", "a", "b")).toBe("a-b");
    expect(_stdlibCore.fmt("Hello {0}, you have {1}", "Ada", 3)).toBe("Hello Ada, you have 3");
  });

  it("reuses an index as many times as the template names it, in any order", () => {
    expect(_stdlibCore.fmt("{1} {0} {1}", "a", "b")).toBe("b a b");
  });

  it("renders an argument the way `+` does — through `show`", () => {
    // `show`: a variant is its tag, a nullish is the empty string, everything
    // else is `String(v)`. A `fmt` that stringified differently would make the
    // same value read two ways in one sentence.
    expect(_stdlibCore.fmt("{0}", { _tag: "None" })).toBe("None");
    expect(_stdlibCore.fmt("[{0}]", null)).toBe("[]");
    expect(_stdlibCore.fmt("{0}", true)).toBe("true");
    expect(_stdlibCore.fmt("{0}", 1.5)).toBe("1.5");
  });

  it("leaves an index the arguments do not reach exactly as written", () => {
    expect(_stdlibCore.fmt("{0} {1}", "a")).toBe("a {1}");
    expect(_stdlibCore.fmt("{3}", "a")).toBe("{3}");
    expect(_stdlibCore.fmt("{0}")).toBe("{0}");
  });

  it("copies through a `{` that opens no placeholder, with no escape", () => {
    expect(_stdlibCore.fmt("{}", "a")).toBe("{}");
    expect(_stdlibCore.fmt("{a}", "a")).toBe("{a}");
    expect(_stdlibCore.fmt("{ 0 }", "a")).toBe("{ 0 }");
    expect(_stdlibCore.fmt("{01", "a")).toBe("{01");
    expect(_stdlibCore.fmt("0}", "a")).toBe("0}");
    // No escape: the inner `{0}` is the placeholder and the outer braces are text.
    expect(_stdlibCore.fmt("{{0}}", "a")).toBe("{a}");
  });

  it("does not re-scan what it substituted", () => {
    // One left-to-right pass. Otherwise a formatted user string could reach
    // back into the argument list and print an argument it was never given.
    expect(_stdlibCore.fmt("{0}", "{1}", "secret")).toBe("{1}");
  });

  it("takes a nullish template as the empty string rather than throwing", () => {
    expect(_stdlibCore.fmt(null, "a")).toBe("");
    expect(_stdlibCore.fmt(undefined)).toBe("");
  });
});
