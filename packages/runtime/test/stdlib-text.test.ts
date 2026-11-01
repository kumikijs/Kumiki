import { File as PlatformFile } from "node:buffer";
import { describe, expect, it } from "vitest";
import { _stdlibCore, type ShowShape } from "../src/stdlib.ts";

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

  it.each([
    [[0x68, 0x69], "aGk="],
    [[0x61, 0x62, 0x63], "YWJj"],
    [[0x41], "QQ=="],
    [[0xff, 0x00, 0x80], "/wCA"],
    [[0xfb, 0xff], "+/8="],
    [[], ""],
  ])("renders %j as padded standard base64 %j", (bytes, expected) => {
    expect(show(bytesFromBytes(bytes))).toBe(expected);
  });

  it.each([
    ["no bytes", new Uint8Array()],
    ["bytes that are not UTF-8", bytesFromBytes([0xff, 0xfe, 0x00])],
    ["UTF-8 bytes", bytesFromText("あ")],
    ["every byte value", Uint8Array.from({ length: 256 }, (_, i) => i)],
    // Spread into one `String.fromCharCode` call, this many bytes overflow V8's stack.
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

describe("show", () => {
  const { show, mapInsert, setOf } = _stdlibCore;
  const tags = setOf(["x"]);

  it.each<[string, unknown, ShowShape | undefined, string]>([
    [
      "a record, in the order it holds its fields",
      { name: "ada", age: 3 },
      undefined,
      '{name: "ada", age: 3}',
    ],
    [
      "a kebab-case field and a variant field",
      { "episode-id": { _tag: "None" }, ok: true },
      undefined,
      "{episode-id: None, ok: true}",
    ],
    [
      "a record and a List inside a record",
      { at: { x: 0, y: -1 }, tags: ["a", "b"] },
      undefined,
      '{at: {x: 0, y: -1}, tags: ["a", "b"]}',
    ],
    ["a List in brackets", [1, 2], undefined, "[1, 2]"],
    ["a List's Text members quoted", ["a", 'say "hi"\n'], undefined, '["a", "say \\"hi\\"\\n"]'],
    ["a List of Lists", [[1], []], undefined, "[[1], []]"],
    ["an empty List", [], undefined, "[]"],
    ["a Text on its own as it is", "ada", undefined, "ada"],
    ["a Text with quotes on its own as it is", 'say "hi"', undefined, 'say "hi"'],
    ["a Float", 1.5, undefined, "1.5"],
    ["a Bool", false, undefined, "false"],
    ["null as the empty string", null, undefined, ""],
    ["undefined as the empty string", undefined, undefined, ""],
    ["Bytes as its base64", new Uint8Array([104, 105]), undefined, "aGk="],
    ["Bytes inside a List as its base64", [new Uint8Array([104, 105])], undefined, "[aGk=]"],
    ["a variant as its tag", { _tag: "Some", _0: 1 }, undefined, "Some"],
    [
      "a variant inside a List as its tag",
      [{ _tag: "Some", _0: 1 }, { _tag: "None" }],
      undefined,
      "[Some, None]",
    ],
    [
      "a variant inside a record as its tag",
      { role: { _tag: "Admin" } },
      undefined,
      "{role: Admin}",
    ],
    [
      "a Text-keyed Map",
      mapInsert(mapInsert({}, "a", 1), "b", 2),
      ["m", 0, 0, 0],
      '{"a": 1, "b": 2}',
    ],
    ["an Int-keyed Map", mapInsert({}, 3, "c"), ["m", "number", 0, 0], '{3: "c"}'],
    ["a Bool-keyed Map", mapInsert({}, true, 1), ["m", "bool", 0, 0], "{true: 1}"],
    [
      "a record-keyed Map",
      mapInsert({}, { y: 0, x: 1 }, "o"),
      ["m", "value", 0, 0],
      '{{x: 1, y: 0}: "o"}',
    ],
    [
      "a Tuple-keyed Map",
      mapInsert({}, [1, 2], 10),
      ["m", "value", ["t", 0, 0], 0],
      "{(1, 2): 10}",
    ],
    ["an empty Map", {}, ["m", 0, 0, 0], "{}"],
    ["an Int Set in brackets", setOf([1, 2]), ["s", "number", 0], "[1, 2]"],
    ["a Text Set, its members quoted", setOf(["a"]), ["s", 0, 0], '["a"]'],
    ["a variant Set", setOf([{ _tag: "Red" }]), ["s", "value", 0], "[Red]"],
    ["an empty Set", {}, ["s", 0, 0], "[]"],
    ["a Tuple in parentheses", [1, "a"], ["t", 0, 0], '(1, "a")'],
    [
      "a Set field by the record's shape",
      { name: "ada", tags },
      { tags: ["s", 0, 0] },
      '{name: "ada", tags: ["x"]}',
    ],
    ["a List of Sets by the List's shape", [tags, {}], ["l", ["s", 0, 0]], '[["x"], []]'],
    [
      "a Map's Tuple values by the Map's shape",
      mapInsert({}, "k", [1, "a"]),
      ["m", 0, 0, ["t", 0, 0]],
      '{"k": (1, "a")}',
    ],
    // Where the checker cannot decide the type, a Map with a `_tag` key reads as a variant.
    ["a Map with a `_tag` key and no shape as a variant", { _tag: "x", b: "y" }, undefined, "x"],
    [
      "a Map with a `_tag` key by its shape",
      { _tag: "x", b: "y" },
      ["m", 0, 0, 0],
      '{"_tag": "x", "b": "y"}',
    ],
    [
      "a `constructor` field the record's shape has no entry for",
      { constructor: { caller: 1 }, m: { a: 1 } },
      { m: ["m", 0, 0, 0] },
      '{constructor: {caller: 1}, m: {"a": 1}}',
    ],
    [
      "a `__proto__` field by the record's own entry for it",
      JSON.parse('{"__proto__": {"a": 1}, "n": 2}'),
      JSON.parse('{"__proto__": ["m", 0, 0, 0]}'),
      '{__proto__: {"a": 1}, n: 2}',
    ],
    // happy-dom's `File` has fields of its own, where a browser's, like Node's, has none.
    [
      "a File as its three fields and the handle on the picked file",
      { name: "a.txt", size: 3, type: "text/plain", _file: new PlatformFile(["abc"], "a.txt") },
      undefined,
      '{name: "a.txt", size: 3, type: "text/plain", _file: {}}',
    ],
  ])("writes %s", (_label, value, shape, expected) => {
    expect(show(value, shape)).toBe(expected);
  });

  it("is what `+` and `fmt` render, for a structured value too", () => {
    expect(_stdlibCore.add("p: ", { name: "ada" })).toBe('p: {name: "ada"}');
    expect(_stdlibCore.add([1, 2], "!")).toBe("[1, 2]!");
    expect(_stdlibCore.fmt("{0} / {1}", { at: { x: 0 } }, ["a"])).toBe('{at: {x: 0}} / ["a"]');
  });
});
