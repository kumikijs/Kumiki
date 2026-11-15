import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EffectResult } from "../src/core.ts";
import {
  sessionClear,
  sessionRead,
  sessionWrite,
  storageClear,
  storageRead,
  storageWrite,
} from "../src/effects-storage.ts";

function message(r: EffectResult): string {
  expect(r.kind).toBe("err");
  // The declared `Text`, not a record wrapping it.
  expect(typeof r.value).toBe("string");
  return r.value as string;
}

function snapshot(storage: Storage): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k !== null) out[k] = storage.getItem(k) ?? "";
  }
  return out;
}

function failing(method: "setItem" | "removeItem" | "clear", error: string): void {
  for (const name of ["localStorage", "sessionStorage"]) {
    const broken = {
      setItem() {},
      removeItem() {},
      clear() {},
      [method]() {
        throw new Error(error);
      },
    };
    vi.stubGlobal(name, broken);
  }
}

const SEEDED = { other: "1", undefined: "kept", "": "blank" };

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  for (const [k, v] of Object.entries(SEEDED)) {
    localStorage.setItem(k, v);
    sessionStorage.setItem(k, v);
  }
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});

describe("storageWrite / sessionWrite: a request that is not a record", () => {
  for (const [label, input] of [
    ["undefined", undefined],
    ["null", null],
    ["a text", "hello"],
    ["a number", 1],
  ] as const) {
    it(`answers err for ${label} and touches nothing`, async () => {
      expect(message(await storageWrite(input))).toMatch(/^storage\.write: .*not a record/);
      expect(message(await sessionWrite(input))).toMatch(/^session\.write: .*not a record/);
      expect(snapshot(localStorage)).toEqual(SEEDED);
      expect(snapshot(sessionStorage)).toEqual(SEEDED);
    });
  }
});

describe("storageWrite: the key", () => {
  for (const [label, req] of [
    ["a remove with no key", { k: "other" }],
    ["a remove with an empty key", { key: "" }],
    ["a remove with a non-text key", { key: 1 }],
    ["a write with no key", { value: 1 }],
    ["a write with an empty key", { key: "", value: 1 }],
  ] as const) {
    it(`answers err for ${label} and touches nothing`, async () => {
      expect(message(await storageWrite(req))).toMatch(/^storage\.write: .*non-empty text key/);
      expect(snapshot(localStorage)).toEqual(SEEDED);
    });
  }
});

describe("storageWrite: the value", () => {
  it("answers err for a value with no stored form, and stores nothing", async () => {
    const m = message(await storageWrite({ key: "t", value: undefined }));
    expect(m).toMatch(/^storage\.write: .*"t"/);
    expect(snapshot(localStorage)).toEqual(SEEDED);
  });
});

const HANDLERS = [
  ["storage", storageWrite, storageRead, () => localStorage],
  ["session", sessionWrite, sessionRead, () => sessionStorage],
] as const;

describe.each(HANDLERS)("%s: a written value reads back as the value it was", (_, write, read) => {
  it.each<[string, unknown]>([
    ["a Bytes", new Uint8Array([104, 105])],
    ["an empty Bytes", new Uint8Array()],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["NaN", Number.NaN],
    ["-0", -0],
    ["a record holding both", { data: new Uint8Array([0, 128, 255]), ratio: Number.NaN }],
    ["a List of Floats", [Number.NEGATIVE_INFINITY, 2.5, Number.NaN, -0]],
    ["a variant", { _tag: "Some", _0: new Uint8Array([7]) }],
    [
      "a Map whose keys start with $, beside a Bytes",
      { $bytes: "aGk=", $float: "NaN", $$j: 1, $: 2, k: new Uint8Array([7]) },
    ],
    ["a Map whose one key is $bytes, beside a NaN", [{ $bytes: "aGk=" }, Number.NaN]],
    ["a Set(Text) whose member starts with $, beside a -0", [{ $a: true, b: true }, -0]],
  ])("%s", async (_, value) => {
    expect(await write({ key: "v", value })).toEqual({ kind: "ok", value: null });
    expect(await read({ key: "v" })).toStrictEqual({
      kind: "ok",
      value: { _tag: "Some", _0: value },
    });
  });

  // A wrong read puts a million-key object here, and a diff of that never finishes, so this
  // row compares the bytes without one.
  it("a 1 MiB Bytes", async () => {
    const value = Uint8Array.from({ length: 1 << 20 }, (_, i) => i % 251);
    expect(await write({ key: "v", value })).toEqual({ kind: "ok", value: null });
    const got = ((await read({ key: "v" })).value as { _0?: unknown })._0;
    const same = got instanceof Uint8Array && got.length === value.length;
    expect(same && got.every((b, i) => b === value[i])).toBe(true);
  });
});

describe.each(HANDLERS)("%s: the stored text", (_, write, read, storage) => {
  it("is the JSON text for a value JSON holds, a Map key that starts with $ included", async () => {
    const value = { $bytes: "aGk=", n: [1, 2.5], o: { _tag: "None" } };
    await write({ key: "m", value });
    expect(storage().getItem("m")).toBe(JSON.stringify(value));
  });

  it("is ~ and the tagged JSON for a value holding a Bytes, a non-finite number or -0", async () => {
    const value = {
      data: new Uint8Array([104, 105]),
      edge: new Uint8Array([251, 255]),
      m: { $k: Number.NaN, $$j: -0.5, z: -0 },
    };
    await write({ key: "t", value });
    expect(storage().getItem("t")).toBe(
      '~{"data":{"$bytes":"aGk="},"edge":{"$bytes":"+/8="},"m":{"$$k":{"$float":"NaN"},"$$$j":-0.5,"z":{"$float":"-0"}}}',
    );
  });

  it("reads a stored JSON text as that JSON, whichever build wrote it", async () => {
    storage().setItem("old", '{"$bytes":"aGk="}');
    expect(await read({ key: "old" })).toStrictEqual({
      kind: "ok",
      value: { _tag: "Some", _0: { $bytes: "aGk=" } },
    });
  });

  it.each([
    ["a Bytes that is not base64", '~{"$bytes":"not base64!"}'],
    ["a Bytes that is not a text", '~{"$bytes":5}'],
    ["a Bytes without its padding", '~{"$bytes":"aGk"}'],
    ["a Bytes with spaces in it", '~{"$bytes":" a G k = "}'],
    ["a tag beside another key", '~{"$bytes":"aGk=","x":1}'],
    ["an unknown tag", '~{"$x":1}'],
    ["a single-$ key beside its unescaped twin", '~{"$a":1,"a":2}'],
    ["an empty Float", '~{"$float":""}'],
    ["a finite Float", '~{"$float":"1.5"}'],
    ["a hex Float", '~{"$float":"0x10"}'],
    ["a Float that is no number", '~{"$float":"abc"}'],
    ["a text that is not JSON", "~{"],
    ["a plain text that is not JSON", "{"],
  ])("answers decode failed, naming the key, for %s", async (_, text) => {
    storage().setItem("bad", text);
    expect(message(await read({ key: "bad" }))).toMatch(/^decode failed: the text under "bad" in /);
  });
});

describe("a failing Web Storage call is an err naming the operation and the key", () => {
  it("setItem", async () => {
    failing("setItem", "quota exceeded");
    expect(message(await storageWrite({ key: "note", value: "x" }))).toBe(
      'localStorage.setItem("note") failed: Error: quota exceeded',
    );
    expect(message(await sessionWrite({ key: "note", value: "x" }))).toBe(
      'sessionStorage.setItem("note") failed: Error: quota exceeded',
    );
  });

  it("removeItem", async () => {
    failing("removeItem", "blocked");
    expect(message(await storageWrite({ key: "note" }))).toBe(
      'localStorage.removeItem("note") failed: Error: blocked',
    );
  });

  it("clear", async () => {
    failing("clear", "blocked");
    expect(message(await storageClear())).toBe("localStorage.clear() failed: Error: blocked");
    expect(message(await sessionClear())).toBe("sessionStorage.clear() failed: Error: blocked");
  });
});

describe("storageClear / sessionClear", () => {
  it("empty their own storage and nothing else", async () => {
    expect(await storageClear()).toEqual({ kind: "ok", value: null });
    expect(snapshot(localStorage)).toEqual({});
    expect(snapshot(sessionStorage)).toEqual(SEEDED);
    expect(await sessionClear()).toEqual({ kind: "ok", value: null });
    expect(snapshot(sessionStorage)).toEqual({});
  });
});

/** `日本語` is three characters and nine UTF-8 bytes, so a text and its bytes cannot be confused. */
const NIHONGO_UTF8 = [0xe6, 0x97, 0xa5, 0xe6, 0x9c, 0xac, 0xe8, 0xaa, 0x9e];
const utf8 = (text: string) => new TextEncoder().encode(text);
const some = (value: unknown) => ({ kind: "ok", value: { _tag: "Some", _0: value } });

describe.each(HANDLERS)("%s: what each decoder delivers", (_, write, read, storage) => {
  it.each<[string, unknown, string, unknown]>([
    ["`Decoder.Text`: a plain text, as it is", "text", "dark", "dark"],
    [
      "`Decoder.Text`: a tagged text, its `~` included",
      "text",
      '~{"$float":"NaN"}',
      '~{"$float":"NaN"}',
    ],
    [
      "`Decoder.Bytes`: a plain text, as its UTF-8",
      "bytes",
      "日本語",
      new Uint8Array(NIHONGO_UTF8),
    ],
    [
      "`Decoder.Bytes`: a tagged Bytes, as those bytes",
      "bytes",
      '~{"$bytes":"aGk="}',
      new Uint8Array([104, 105]),
    ],
    [
      "`Decoder.Bytes`: a tagged record, as its UTF-8",
      "bytes",
      '~{"b":{"$bytes":"aGk="}}',
      utf8('~{"b":{"$bytes":"aGk="}}'),
    ],
    [
      "`Decoder.Bytes`: a tagged text that does not decode, as its UTF-8",
      "bytes",
      '~{"$bytes":"!"}',
      utf8('~{"$bytes":"!"}'),
    ],
    ["`Decoder.None`: Unit, whatever the text", "none", "{", null],
    ["`Decoder.Json`: the parsed text", "json", '[{"t":"日本語"}]', [{ t: "日本語" }]],
    ["`Decoder.Json`: the decoded tagged text", "json", '~{"$float":"NaN"}', Number.NaN],
    ["no decoder: the parsed text", undefined, '[{"t":"日本語"}]', [{ t: "日本語" }]],
    ["a `null` decoder: the parsed text", null, '[{"t":"日本語"}]', [{ t: "日本語" }]],
  ])("from a stored text, %s", async (_, decode, stored, delivered) => {
    storage().setItem("k", stored);
    expect(await read({ key: "k", decode })).toStrictEqual(some(delivered));
  });

  // A write stores its value as JSON, so `Decoder.Json` is what reads it back; a `Bytes` alone
  // is the one value another decoder reads back too.
  it.each<[string, unknown, string, unknown]>([
    ["a Text, under `Decoder.Json`, as itself", "dark", "json", "dark"],
    ["a Text, under `Decoder.Text`, as its JSON, quotes included", "dark", "text", '"dark"'],
    [
      "a Bytes, under `Decoder.Bytes`, as itself",
      new Uint8Array([0, 255]),
      "bytes",
      new Uint8Array([0, 255]),
    ],
    [
      "an empty Bytes, under `Decoder.Bytes`, as itself",
      new Uint8Array(),
      "bytes",
      new Uint8Array(),
    ],
    [
      "a record holding a Bytes, under `Decoder.Bytes`, as its stored text's UTF-8",
      { b: new Uint8Array([104, 105]) },
      "bytes",
      utf8('~{"b":{"$bytes":"aGk="}}'),
    ],
    [
      "Infinity, under `Decoder.Text`, as its tagged text",
      Number.POSITIVE_INFINITY,
      "text",
      '~{"$float":"Infinity"}',
    ],
  ])("a write stored %s", async (_, value, decode, delivered) => {
    expect(await write({ key: "k", value })).toEqual({ kind: "ok", value: null });
    expect(await read({ key: "k", decode })).toStrictEqual(some(delivered));
  });

  it.each([
    undefined,
    "json",
    "text",
    "bytes",
    "none",
  ])("a missing key is None under %s", async (decode) => {
    expect(await read({ key: "absent", decode })).toStrictEqual({
      kind: "ok",
      value: { _tag: "None" },
    });
  });

  it.each<[unknown, string]>([
    ["TEXT", '"TEXT"'],
    [1, "1"],
    [{ kind: "text" }, '{"kind":"text"}'],
    [Object.create(null), "{}"],
    [Symbol("text"), "symbol"],
    [10n, "bigint"],
  ])("a decode of %s is no decoder, so the read is an err naming it as %s", async (decode, shown) => {
    storage().setItem("k", "dark");
    const err = { kind: "err", value: `decode is ${shown}, which is not a Decoder` };
    expect(await read({ key: "k", decode })).toStrictEqual(err);
    expect(await read({ key: "absent", decode })).toStrictEqual(err);
  });
});

describe("a stored text that does not parse under `Decoder.Json`", () => {
  it("is a decode failure naming the key and the storage", async () => {
    localStorage.setItem("theme", "dark");
    sessionStorage.setItem("theme", "dark");
    expect(message(await storageRead({ key: "theme", decode: "json" }))).toMatch(
      /^decode failed: the text under "theme" in localStorage is not a stored value \(SyntaxError: /,
    );
    expect(message(await sessionRead({ key: "theme", decode: "json" }))).toMatch(
      /^decode failed: the text under "theme" in sessionStorage is not a stored value \(SyntaxError: /,
    );
  });
});

describe("a handler resolves to its Text err; it never rejects", () => {
  it("when the storage getter itself throws, as in an opaque-origin sandbox", async () => {
    const names = ["localStorage", "sessionStorage"] as const;
    const saved = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
    for (const name of names) {
      Object.defineProperty(globalThis, name, {
        configurable: true,
        get() {
          throw new DOMException("denied", "SecurityError");
        },
      });
    }
    try {
      expect(message(await storageRead({ key: "k" }))).toBe("SecurityError: denied");
      expect(message(await sessionRead({ key: "k" }))).toBe("SecurityError: denied");
      expect(message(await storageWrite({ key: "k", value: 1 }))).toBe(
        'localStorage.setItem("k") failed: SecurityError: denied',
      );
      expect(message(await sessionClear())).toBe(
        "sessionStorage.clear() failed: SecurityError: denied",
      );
    } finally {
      names.forEach((name, i) => {
        const original = saved[i];
        if (original) Object.defineProperty(globalThis, name, original);
        else Reflect.deleteProperty(globalThis, name);
      });
    }
  });

  it("when a read has no request (in=Unit, no map-request)", async () => {
    expect(message(await storageRead(undefined))).toMatch(/^TypeError: /);
    expect(message(await sessionRead(undefined))).toMatch(/^TypeError: /);
  });
});
