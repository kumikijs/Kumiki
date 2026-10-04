// The storage.* / session.* handlers (http.md §6.7.2 / §6.7.4). Every
// failure is an `err` result, never a throw and never a partial effect: a
// request that is not one of the three shapes touches nothing, and a failing
// Web Storage call names the operation and the key, so a quota error on one
// key reads differently from a program that built the wrong request. A value
// is stored as the text §6.7.2 gives it and reads back as the value it was.

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
  // The declared `Text`, not a record wrapping it (http.md §6.7).
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

/**
 * Replace both storages with ones whose `method` throws. The handlers look the
 * storage up on each call, so a stubbed global is what they reach. (A spy on
 * `Storage.prototype` is not enough in happy-dom: a storage that has already
 * been used keeps calling the original method.)
 */
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

describe("a written value reads back as the value it was", () => {
  for (const [label, value] of [
    ["a Bytes", new Uint8Array([104, 105])],
    ["an empty Bytes", new Uint8Array()],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["NaN", Number.NaN],
    ["a record holding both", { data: new Uint8Array([0, 128, 255]), ratio: Number.NaN }],
    ["a List of Floats", [Number.NEGATIVE_INFINITY, 2.5, Number.NaN]],
    ["a variant", { _tag: "Some", _0: new Uint8Array([7]) }],
    [
      "a Map whose keys start with $, beside a Bytes",
      { $bytes: "aGk=", $float: "NaN", $$j: 1, $: 2, k: new Uint8Array([7]) },
    ],
    ["a Map whose one key is $bytes, beside a NaN", [{ $bytes: "aGk=" }, Number.NaN]],
  ] as const) {
    it(label, async () => {
      for (const [, write, read] of HANDLERS) {
        expect(await write({ key: "v", value })).toEqual({ kind: "ok", value: null });
        expect(await read({ key: "v" })).toStrictEqual({
          kind: "ok",
          value: { _tag: "Some", _0: value },
        });
      }
    });
  }
});

describe("the stored text (http.md §6.7.2)", () => {
  it("is the JSON text for a value JSON holds, a Map key that starts with $ included", async () => {
    const value = { $bytes: "aGk=", n: [1, 2.5], o: { _tag: "None" } };
    for (const [, write, , storage] of HANDLERS) {
      await write({ key: "m", value });
      expect(storage().getItem("m")).toBe(JSON.stringify(value));
    }
  });

  it("is ~ and the tagged JSON for a value holding a Bytes or a non-finite number", async () => {
    const value = { data: new Uint8Array([104, 105]), m: { $k: Number.NaN, $$j: -0.5 } };
    for (const [, write, , storage] of HANDLERS) {
      await write({ key: "t", value });
      expect(storage().getItem("t")).toBe(
        '~{"data":{"$bytes":"aGk="},"m":{"$$k":{"$float":"NaN"},"$$$j":-0.5}}',
      );
    }
  });

  it("reads a stored JSON text as that JSON, whichever build wrote it", async () => {
    for (const [, , read, storage] of HANDLERS) {
      storage().setItem("old", '{"$bytes":"aGk="}');
      expect(await read({ key: "old" })).toStrictEqual({
        kind: "ok",
        value: { _tag: "Some", _0: { $bytes: "aGk=" } },
      });
    }
  });

  it("answers err for a tagged text whose Bytes is not base64", async () => {
    for (const [, , read, storage] of HANDLERS) {
      storage().setItem("bad", '~{"$bytes":"not base64!"}');
      expect(message(await read({ key: "bad" }))).toMatch(/^InvalidCharacterError: /);
    }
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

describe("a handler resolves to its Text err; it never rejects", () => {
  // A rejection skips the err contract: it reaches the dispatcher, which
  // delivers a `{message}` record where `.err` expects the `Text`.
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
