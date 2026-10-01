// The storage.* / session.* write handlers (http.md §6.7.2 / §6.7.4). Every
// failure is an `err` result, never a throw and never a partial effect: a
// request that is not one of the three shapes touches nothing, and a failing
// Web Storage call names the operation and the key, so a quota error on one
// key reads differently from a program that built the wrong request.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EffectResult } from "../src/core.ts";
import { sessionClear, sessionWrite, storageClear, storageWrite } from "../src/effects-storage.ts";

function message(r: EffectResult): string {
  expect(r.kind).toBe("err");
  return (r.value as { message: string }).message;
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
  it("answers err for a value JSON cannot encode, and stores nothing", async () => {
    const m = message(await storageWrite({ key: "t", value: undefined }));
    expect(m).toMatch(/^storage\.write: .*"t"/);
    expect(snapshot(localStorage)).toEqual(SEEDED);
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
