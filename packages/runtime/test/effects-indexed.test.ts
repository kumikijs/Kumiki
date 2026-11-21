import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EffectResult } from "../src/core.ts";
import {
  type IndexedDbCfg,
  indexedDelete,
  indexedRead,
  indexedWrite,
} from "../src/effects-indexed.ts";

const cfg: IndexedDbCfg = {
  name: "test-db",
  version: 1,
  stores: [{ name: "notes", key: "id" }],
};

describe("indexed-* without config", () => {
  // The err value is the `Text` the effect's `Result(_, Text)` declares, not a record wrapping it.
  it.each([
    ["indexedRead", () => indexedRead({ store: "notes", key: "a" }, undefined)],
    [
      "indexedWrite",
      () => indexedWrite({ store: "notes", key: "a", value: { id: "a" } }, undefined),
    ],
    ["indexedDelete", () => indexedDelete({ store: "notes", key: "a" }, undefined)],
  ])("%s returns a clean error when cfg is absent", async (_name, run) => {
    expect(await run()).toEqual({ kind: "err", value: "app.indexed-db is not declared" });
  });
});

describe("indexed-* unavailable backend", () => {
  const original = (globalThis as { indexedDB?: unknown }).indexedDB;
  beforeEach(() => {
    (globalThis as { indexedDB?: unknown }).indexedDB = undefined;
  });
  afterEach(() => {
    (globalThis as { indexedDB?: unknown }).indexedDB = original;
  });

  it("indexedRead reports a clean error when indexedDB is missing, and does not keep it", async () => {
    // A fresh cfg avoids hitting the cached open() promise from earlier tests.
    const localCfg: IndexedDbCfg = { ...cfg, name: "missing-db" };
    const r = await indexedRead({ store: "notes", key: "a" }, localCfg);
    expect(r).toEqual({ kind: "err", value: expect.stringMatching(/IndexedDB is not available/) });

    (globalThis as { indexedDB?: unknown }).indexedDB = makeMockIndexedDb();
    expect((await indexedRead({ store: "notes", key: "a" }, localCfg)).kind).toBe("ok");
  });

  it("an open() that throws is that call's err, and the next call opens again", async () => {
    const localCfg: IndexedDbCfg = { ...cfg, name: "insecure-db" };
    (globalThis as { indexedDB?: unknown }).indexedDB = {
      open(): never {
        throw new DOMException("The operation is insecure.", "SecurityError");
      },
    };
    expect(await indexedRead({ store: "notes", key: "a" }, localCfg)).toEqual({
      kind: "err",
      value: "SecurityError: The operation is insecure.",
    });

    (globalThis as { indexedDB?: unknown }).indexedDB = makeMockIndexedDb();
    expect((await indexedRead({ store: "notes", key: "a" }, localCfg)).kind).toBe("ok");
  });
});

describe("indexed-* effects that start while the open is pending", () => {
  const original = (globalThis as { indexedDB?: unknown }).indexedDB;
  afterEach(() => {
    (globalThis as { indexedDB?: unknown }).indexedDB = original;
    vi.restoreAllMocks();
  });

  it("share an open that reports blocked, which then succeeds", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const idb = scriptedIndexedDb(["blocked"]);
    const localCfg: IndexedDbCfg = { ...cfg, name: "blocked-db", version: 2 };
    const reads = await Promise.all([
      indexedRead({ store: "notes", key: "a" }, localCfg),
      indexedRead({ store: "notes", key: "b" }, localCfg),
    ]);
    expect(reads.map((r) => r.kind)).toEqual(["ok", "ok"]);
    expect(idb.opens).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      'kumiki: app.indexed-db "blocked-db" upgrade 1 -> 2 is blocked by other open connections; indexed-* effects wait until they close',
    );
  });

  it("share an open that fails, and the call after them opens again", async () => {
    const idb = scriptedIndexedDb(["error", "success"]);
    const localCfg: IndexedDbCfg = { ...cfg, name: "failing-db" };
    const reads = await Promise.all([
      indexedRead({ store: "notes", key: "a" }, localCfg),
      indexedRead({ store: "notes", key: "b" }, localCfg),
    ]);
    expect(reads).toEqual([
      { kind: "err", value: "UnknownError: the open failed" },
      { kind: "err", value: "UnknownError: the open failed" },
    ]);
    expect(idb.opens).toBe(1);

    expect((await indexedRead({ store: "notes", key: "a" }, localCfg)).kind).toBe("ok");
    expect(idb.opens).toBe(2);
  });
});

describe("indexed-* happy path with in-memory mock", () => {
  const original = (globalThis as { indexedDB?: unknown }).indexedDB;

  beforeEach(() => {
    (globalThis as { indexedDB?: unknown }).indexedDB = makeMockIndexedDb();
  });
  afterEach(() => {
    (globalThis as { indexedDB?: unknown }).indexedDB = original;
  });

  it("a request that is missing (in=Unit, no map-request) is a Text err, not a rejection", async () => {
    const localCfg: IndexedDbCfg = { ...cfg, name: "happy-db-no-request" };
    for (const run of [indexedRead, indexedWrite, indexedDelete]) {
      expect(await run(undefined, localCfg)).toEqual({
        kind: "err",
        value: expect.stringMatching(/^TypeError: /),
      });
    }
  });

  it("write then read returns Some(value); missing key returns None", async () => {
    const localCfg: IndexedDbCfg = { ...cfg, name: "happy-db-1" };
    const w = await indexedWrite({ store: "notes", key: "a", value: { body: "hello" } }, localCfg);
    expect(w.kind).toBe("ok");

    const r = await indexedRead({ store: "notes", key: "a" }, localCfg);
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(r.value).toMatchObject({ _tag: "Some" });

    const miss = await indexedRead({ store: "notes", key: "nope" }, localCfg);
    expect(miss.kind).toBe("ok");
    if (miss.kind !== "ok") return;
    expect(miss.value).toMatchObject({ _tag: "None" });
  });

  it("a point read whose Decoder.Json check refuses the record is an err", async () => {
    const localCfg: IndexedDbCfg = { ...cfg, name: "happy-db-decode" };
    await indexedWrite({ store: "notes", key: "a", value: { body: "" } }, localCfg);
    const check = (v: unknown) =>
      (v as { body: string }).body.length > 0
        ? undefined
        : { kind: "nonempty", args: [], path: ["body"] };
    expect(await indexedRead({ store: "notes", key: "a", decode: check }, localCfg)).toEqual({
      kind: "err",
      value: "decode failed: nonempty at .body",
    });
  });

  // A record is no text: `Decoder.Text` and `Decoder.Bytes` cannot read one, and `Decoder.None`
  // answers only whether it is there. Each holds whether or not the key is.
  it.each<[string, unknown, EffectResult, EffectResult]>([
    [
      "`Decoder.Text` is an err",
      "text",
      {
        kind: "err",
        value: "decode failed: indexed.read holds records, which Decoder.Text cannot read",
      },
      {
        kind: "err",
        value: "decode failed: indexed.read holds records, which Decoder.Text cannot read",
      },
    ],
    [
      "`Decoder.Bytes` is an err",
      "bytes",
      {
        kind: "err",
        value: "decode failed: indexed.read holds records, which Decoder.Bytes cannot read",
      },
      {
        kind: "err",
        value: "decode failed: indexed.read holds records, which Decoder.Bytes cannot read",
      },
    ],
    [
      "`Decoder.None` is Some(Unit), or None",
      "none",
      { kind: "ok", value: { _tag: "Some", _0: null } },
      { kind: "ok", value: { _tag: "None" } },
    ],
    [
      "a decode that is no decoder is an err naming it",
      "TEXT",
      { kind: "err", value: 'decode is "TEXT", which is not a Decoder' },
      { kind: "err", value: 'decode is "TEXT", which is not a Decoder' },
    ],
  ])("on a point read, %s", async (name, decode, stored, missing) => {
    const localCfg: IndexedDbCfg = { ...cfg, name: `happy-db-decoder-${name}` };
    await indexedWrite({ store: "notes", key: "a", value: { body: "hello" } }, localCfg);
    expect(await indexedRead({ store: "notes", key: "a", decode }, localCfg)).toStrictEqual(stored);
    expect(await indexedRead({ store: "notes", key: "b", decode }, localCfg)).toStrictEqual(
      missing,
    );
  });

  it("delete removes a previously written value", async () => {
    const localCfg: IndexedDbCfg = { ...cfg, name: "happy-db-2" };
    await indexedWrite({ store: "notes", key: "a", value: { body: "x" } }, localCfg);
    const d = await indexedDelete({ store: "notes", key: "a" }, localCfg);
    expect(d.kind).toBe("ok");
    const r = await indexedRead({ store: "notes", key: "a" }, localCfg);
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(r.value).toMatchObject({ _tag: "None" });
  });

  it("gives back a Bytes and a non-finite number inside the written record as themselves", async () => {
    const localCfg: IndexedDbCfg = { ...cfg, name: "happy-db-clone" };
    const value = { data: new Uint8Array([104, 105]), ratio: Number.POSITIVE_INFINITY };
    expect((await indexedWrite({ store: "notes", key: "a", value }, localCfg)).kind).toBe("ok");
    expect(await indexedRead({ store: "notes", key: "a" }, localCfg)).toStrictEqual({
      kind: "ok",
      value: { _tag: "Some", _0: { ...value, id: "a" } },
    });
  });

  describe("a query's range, written as IndexRange spells it", () => {
    beforeEach(() => {
      vi.stubGlobal("IDBKeyRange", KEY_RANGE);
    });
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    const some = (k: number) => ({ _tag: "Some", _0: k });
    const none = { _tag: "None" };
    it.each([
      [
        "both bounds, the upper one open",
        { lower: some(10), upper: some(20), lowerOpen: false, upperOpen: true },
        ["a", "b"],
      ],
      [
        "a lower bound that is open",
        { lower: some(10), upper: none, lowerOpen: true, upperOpen: false },
        ["b", "c"],
      ],
      [
        "an upper bound that is closed",
        { lower: none, upper: some(15), lowerOpen: false, upperOpen: false },
        ["a", "b"],
      ],
      [
        "no bound",
        { lower: none, upper: none, lowerOpen: false, upperOpen: false },
        ["a", "b", "c"],
      ],
    ])("given %s, reads the records whose key it holds", async (what, range, ids) => {
      const localCfg: IndexedDbCfg = { ...cfg, name: `happy-db-range-${what}` };
      for (const [id, at] of [
        ["a", 10],
        ["b", 15],
        ["c", 20],
      ] as const) {
        await indexedWrite({ store: "notes", key: id, value: { at } }, localCfg);
      }
      const r = await indexedRead(
        { store: "notes", index: { _tag: "Some", _0: "at" }, range: { _tag: "Some", _0: range } },
        localCfg,
      );
      expect(r.kind === "ok" && (r.value as { id: string }[]).map((n) => n.id)).toEqual(ids);
    });
  });

  it("indexedRead falls back to query when no key is given", async () => {
    const localCfg: IndexedDbCfg = { ...cfg, name: "happy-db-3" };
    await indexedWrite({ store: "notes", key: "a", value: { body: "1" } }, localCfg);
    await indexedWrite({ store: "notes", key: "b", value: { body: "2" } }, localCfg);
    const r = await indexedRead({ store: "notes" }, localCfg);
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(Array.isArray(r.value)).toBe(true);
    expect((r.value as unknown[]).length).toBe(2);
  });
});

type KeyRange = { lower?: number; upper?: number; lowerOpen?: boolean; upperOpen?: boolean };

/** `IDBKeyRange`'s constructors, building the range a real one holds, over number keys. */
const KEY_RANGE = {
  bound: (lower: number, upper: number, lowerOpen: boolean, upperOpen: boolean): KeyRange => ({
    lower,
    upper,
    lowerOpen,
    upperOpen,
  }),
  lowerBound: (lower: number, lowerOpen: boolean): KeyRange => ({ lower, lowerOpen }),
  upperBound: (upper: number, upperOpen: boolean): KeyRange => ({ upper, upperOpen }),
};

function inRange(key: number | undefined, r: KeyRange | undefined): boolean {
  if (r === undefined) return true;
  if (key === undefined) return false;
  const aboveLower = r.lower === undefined || (r.lowerOpen ? key > r.lower : key >= r.lower);
  const belowUpper = r.upper === undefined || (r.upperOpen ? key < r.upper : key <= r.upper);
  return aboveLower && belowUpper;
}

type Opening = "success" | "blocked" | "error";

/**
 * Each `open()` answers with the next entry of `script`, the last one repeating, after a timer so
 * that calls made together are all pending at once. `blocked` comes before a later success on the
 * same request, as the IndexedDB open steps send it, and the success is `makeMockIndexedDb`'s.
 */
function scriptedIndexedDb(script: Opening[]): { opens: number } {
  const inner = makeMockIndexedDb();
  const double = { opens: 0 };
  const call = (target: object, handler: unknown, ev: Event): void => {
    if (typeof handler === "function") handler.call(target, ev);
  };
  const factory = {
    open(name: string, version: number): object {
      const how = script[Math.min(double.opens, script.length - 1)];
      double.opens++;
      const req: Record<string, unknown> = {
        result: undefined,
        error: null,
        transaction: null,
        onsuccess: null,
        onerror: null,
        onblocked: null,
        onupgradeneeded: null,
      };
      const succeed = (): void => {
        const real = inner.open(name, version);
        real.onupgradeneeded = (ev) => {
          req.result = real.result;
          req.transaction = real.transaction;
          call(req, req.onupgradeneeded, ev);
        };
        real.onsuccess = (ev) => {
          req.result = real.result;
          call(req, req.onsuccess, ev);
        };
      };
      setTimeout(() => {
        if (how === "error") {
          req.error = new DOMException("the open failed", "UnknownError");
          call(req, req.onerror, new Event("error"));
        } else if (how === "blocked") {
          const ev = Object.assign(new Event("blocked"), { oldVersion: 1, newVersion: version });
          call(req, req.onblocked, ev);
          setTimeout(succeed, 20);
        } else {
          succeed();
        }
      });
      return req;
    },
  };
  (globalThis as { indexedDB?: unknown }).indexedDB = factory;
  return double;
}

function makeMockIndexedDb(): IDBFactory {
  const dbs = new Map<string, Map<string, Map<string, unknown>>>();
  function makeRequest<T>(value: T): IDBRequest<T> {
    const req = {
      result: value,
      error: null,
      onsuccess: null as ((this: IDBRequest, ev: Event) => unknown) | null,
      onerror: null as ((this: IDBRequest, ev: Event) => unknown) | null,
    } as unknown as IDBRequest<T>;
    queueMicrotask(() => {
      req.onsuccess?.call(req, {} as Event);
    });
    return req;
  }
  return {
    open(name: string): IDBOpenDBRequest {
      let stores = dbs.get(name);
      const needsUpgrade = !stores;
      if (!stores) {
        stores = new Map();
        dbs.set(name, stores);
      }
      const transactionStores = stores;
      const db = {
        objectStoreNames: {
          contains: (s: string) => transactionStores.has(s),
        },
        createObjectStore: (s: string) => {
          transactionStores.set(s, new Map());
          return {
            indexNames: { contains: () => false },
            createIndex: () => undefined,
          };
        },
        transaction: (s: string) => makeTx(transactionStores, s),
      } as unknown as IDBDatabase;
      const req = {
        result: db,
        error: null,
        transaction: {
          objectStore: (s: string) => ({
            indexNames: { contains: () => false },
            createIndex: () => undefined,
            keyPath: stores?.has(s) ? "id" : "id",
          }),
        },
        onsuccess: null as ((this: IDBOpenDBRequest, ev: Event) => unknown) | null,
        onerror: null as unknown,
        onupgradeneeded: null as
          | ((this: IDBOpenDBRequest, ev: IDBVersionChangeEvent) => unknown)
          | null,
        onblocked: null as unknown,
      } as unknown as IDBOpenDBRequest;
      queueMicrotask(() => {
        if (needsUpgrade) req.onupgradeneeded?.call(req, {} as IDBVersionChangeEvent);
        req.onsuccess?.call(req, {} as Event);
      });
      return req;
    },
  } as unknown as IDBFactory;

  function makeTx(stores: Map<string, Map<string, unknown>>, storeName: string): IDBTransaction {
    const store = stores.get(storeName);
    if (!store) throw new Error(`Unknown store ${storeName}`);
    return {
      objectStore: () => ({
        keyPath: "id",
        get: (key: string) => makeRequest(store.get(key)),
        put: (record: { id: string }) => {
          // IndexedDB keeps a structured clone of the record, not the record itself.
          store.set(record.id, structuredClone(record));
          return makeRequest(undefined);
        },
        delete: (key: string) => {
          store.delete(key);
          return makeRequest(undefined);
        },
        getAll: () => makeRequest([...store.values()]),
        index: (name: string) => ({
          getAll: (range?: KeyRange) =>
            makeRequest(
              [...store.values()].filter((r) =>
                inRange((r as Record<string, number>)[name], range),
              ),
            ),
        }),
      }),
    } as unknown as IDBTransaction;
  }
}
