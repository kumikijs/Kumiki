// indexed-* effect coverage for app.indexed-db (#79). The unavailable-config
// branch matters most: parity with storage (#37) requires a clean error
// result, not a throw. Happy-path coverage uses a small in-memory mock that
// implements just enough of the IndexedDB request shape to drive the runtime.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

describe("indexed-* without config (#79)", () => {
  it("indexedRead returns a clean error when cfg is absent", async () => {
    const r = await indexedRead({ store: "notes", key: "a" }, undefined);
    expect(r.kind).toBe("err");
    if (r.kind !== "err") return;
    expect((r.value as { message: string }).message).toMatch(/indexed-db is not declared/);
  });

  it("indexedWrite returns a clean error when cfg is absent", async () => {
    const r = await indexedWrite({ store: "notes", key: "a", value: { id: "a" } }, undefined);
    expect(r.kind).toBe("err");
  });

  it("indexedDelete returns a clean error when cfg is absent", async () => {
    const r = await indexedDelete({ store: "notes", key: "a" }, undefined);
    expect(r.kind).toBe("err");
  });
});

describe("indexed-* unavailable backend (#79)", () => {
  const original = (globalThis as { indexedDB?: unknown }).indexedDB;
  beforeEach(() => {
    (globalThis as { indexedDB?: unknown }).indexedDB = undefined;
  });
  afterEach(() => {
    (globalThis as { indexedDB?: unknown }).indexedDB = original;
  });

  it("indexedRead reports a clean error when indexedDB is missing", async () => {
    // A fresh cfg avoids hitting the cached open() promise from earlier tests.
    const localCfg: IndexedDbCfg = { ...cfg, name: "missing-db" };
    const r = await indexedRead({ store: "notes", key: "a" }, localCfg);
    expect(r.kind).toBe("err");
    if (r.kind !== "err") return;
    expect((r.value as { message: string }).message).toMatch(/IndexedDB is not available/);
  });
});

describe("indexed-* happy path with in-memory mock (#79)", () => {
  const original = (globalThis as { indexedDB?: unknown }).indexedDB;

  beforeEach(() => {
    (globalThis as { indexedDB?: unknown }).indexedDB = makeMockIndexedDb();
  });
  afterEach(() => {
    (globalThis as { indexedDB?: unknown }).indexedDB = original;
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

// A minimal mock that mirrors enough of IndexedDB's request/transaction shape
// for our handlers — fully in-memory, one DB per name. Keeps the test free of
// fake-indexeddb dependency drift.
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
        onupgradeneeded: null as ((this: IDBOpenDBRequest, ev: Event) => unknown) | null,
        onblocked: null as unknown,
      } as unknown as IDBOpenDBRequest;
      queueMicrotask(() => {
        if (needsUpgrade) req.onupgradeneeded?.call(req, {} as Event);
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
          store.set(record.id, record);
          return makeRequest(undefined);
        },
        delete: (key: string) => {
          store.delete(key);
          return makeRequest(undefined);
        },
        getAll: () => makeRequest([...store.values()]),
        index: () => ({ getAll: () => makeRequest([...store.values()]) }),
      }),
    } as unknown as IDBTransaction;
  }
}
