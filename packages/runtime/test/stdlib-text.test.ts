import { describe, expect, it } from "vitest";
import { _stdlibCore } from "../src/stdlib.ts";

describe("Bytes constructors", () => {
  it("bytesFromText UTF-8 encodes the string", () => {
    expect(_stdlibCore.bytesFromText("hi")).toEqual(new Uint8Array([0x68, 0x69]));
    expect(_stdlibCore.bytesFromText("")).toEqual(new Uint8Array([]));
    expect(_stdlibCore.bytesFromText("あ")).toEqual(new Uint8Array([0xe3, 0x81, 0x82]));
  });

  it("bytesFromText coerces nullish to empty without throwing", () => {
    expect(_stdlibCore.bytesFromText(null)).toEqual(new Uint8Array([]));
    expect(_stdlibCore.bytesFromText(undefined)).toEqual(new Uint8Array([]));
  });

  it("bytesFromBase64 decodes standard base64", () => {
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
    expect(_stdlibCore.bytesFromBytes([1, 2, 256, 257])).toEqual(new Uint8Array([1, 2, 0, 1]));
    expect(_stdlibCore.bytesFromBytes([])).toEqual(new Uint8Array([]));
  });

  it("bytesFromBytes falls back to an empty Uint8Array for non-list input", () => {
    expect(_stdlibCore.bytesFromBytes(null)).toEqual(new Uint8Array([]));
    expect(_stdlibCore.bytesFromBytes(undefined)).toEqual(new Uint8Array([]));
  });
});

describe("fmt", () => {
  it("replaces each {n} with the argument at that index", () => {
    expect(_stdlibCore.fmt("{0}-{1}", "a", "b")).toBe("a-b");
    expect(_stdlibCore.fmt("Hello {0}, you have {1}", "Ada", 3)).toBe("Hello Ada, you have 3");
  });

  it("reuses an index as many times as the template names it, in any order", () => {
    expect(_stdlibCore.fmt("{1} {0} {1}", "a", "b")).toBe("b a b");
  });

  it("renders an argument through `show`", () => {
    expect(_stdlibCore.fmt("{0}", { _tag: "None" })).toBe("None");
    expect(_stdlibCore.fmt("[{0}]", null)).toBe("[]");
    expect(_stdlibCore.fmt("{0}", true)).toBe("true");
    expect(_stdlibCore.fmt("{0}", 1.5)).toBe("1.5");
  });

  it("agrees with `+` on every value", () => {
    for (const v of [{ _tag: "None" }, { _tag: "Some", _0: 1 }, null, undefined, true, 1.5, "s"]) {
      expect(_stdlibCore.fmt("{0}", v)).toBe(_stdlibCore.add("", v));
    }
  });

  it("leaves an index the arguments do not reach exactly as written", () => {
    expect(_stdlibCore.fmt("{0} {1}", "a")).toBe("a {1}");
    expect(_stdlibCore.fmt("{3}", "a")).toBe("{3}");
    expect(_stdlibCore.fmt("{0}")).toBe("{0}");
  });

  it("drops an argument no placeholder names", () => {
    expect(_stdlibCore.fmt("{0}", "a", "b")).toBe("a");
    expect(_stdlibCore.fmt("none here", "a")).toBe("none here");
  });

  it("copies through a `{` that opens no placeholder, with no escape", () => {
    expect(_stdlibCore.fmt("{}", "a")).toBe("{}");
    expect(_stdlibCore.fmt("{a}", "a")).toBe("{a}");
    expect(_stdlibCore.fmt("{ 0 }", "a")).toBe("{ 0 }");
    expect(_stdlibCore.fmt("{01", "a")).toBe("{01");
    expect(_stdlibCore.fmt("0}", "a")).toBe("0}");
    expect(_stdlibCore.fmt("{01}", "a", "b")).toBe("b");
    expect(_stdlibCore.fmt("{{0}}", "a")).toBe("{a}");
  });

  it("does not re-scan what it substituted", () => {
    expect(_stdlibCore.fmt("{0}", "{1}", "secret")).toBe("{1}");
  });

  it("takes a nullish template as the empty string rather than throwing", () => {
    expect(_stdlibCore.fmt(null, "a")).toBe("");
    expect(_stdlibCore.fmt(undefined)).toBe("");
  });
});
