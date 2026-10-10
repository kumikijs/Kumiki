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

describe("show on Bytes", () => {
  const { show, eq, bytesFromBase64, bytesFromText, bytesFromBytes } = _stdlibCore;

  it("renders the bytes as padded standard base64", () => {
    expect(show(bytesFromText("hi"))).toBe("aGk=");
    expect(show(bytesFromText("abc"))).toBe("YWJj");
    expect(show(bytesFromBytes([0xff, 0x00, 0x80]))).toBe("/wCA");
    expect(show(bytesFromBytes([0xfb, 0xff]))).toBe("+/8=");
    expect(show(new Uint8Array())).toBe("");
  });

  it.each([
    ["no bytes", new Uint8Array()],
    ["bytes that are not UTF-8", bytesFromBytes([0xff, 0xfe, 0x00])],
    ["UTF-8 bytes", bytesFromText("あ")],
    ["every byte value", Uint8Array.from({ length: 256 }, (_, i) => i)],
    // Larger than any argument list a platform call can be spread into.
    ["a large buffer", Uint8Array.from({ length: 1 << 18 }, (_, i) => (i * 7) & 0xff)],
  ])("is read back by Bytes.from-base64 for %s", (_, b) => {
    expect(eq(bytesFromBase64(show(b)), b)).toBe(true);
  });

  it("is what `+` and `fmt` render a Bytes as", () => {
    const b = bytesFromText("hi");
    expect(_stdlibCore.add("b=", b)).toBe("b=aGk=");
    expect(_stdlibCore.add(b, "!")).toBe("aGk=!");
    expect(_stdlibCore.fmt("b={0}", b)).toBe("b=aGk=");
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
    const values = [
      { _tag: "None" },
      { _tag: "Some", _0: 1 },
      null,
      undefined,
      true,
      1.5,
      "s",
      new Uint8Array([0x68, 0x69]),
    ];
    for (const v of values) {
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
