// indexed.* built-in capability handlers (#79): shipped only when an app
// declares an indexed-* effect. The DB is opened lazily on the first call so
// apps that never actually run an effect don't trigger an upgrade transaction.

import type { EffectResult } from "./core.ts";
import { _stdlibCore } from "./stdlib.ts";

export type IndexedDbStore = { name: string; key: string; indexes?: string[] };
export type IndexedDbCfg = {
  name: string;
  version: number;
  stores: IndexedDbStore[];
};

export type IndexRange = {
  lower?: unknown;
  upper?: unknown;
  lowerOpen?: boolean;
  upperOpen?: boolean;
};

const handles = new WeakMap<IndexedDbCfg, Promise<IDBDatabase>>();

function openDb(cfg: IndexedDbCfg): Promise<IDBDatabase> {
  const cached = handles.get(cfg);
  if (cached) return cached;
  const p = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available in this environment"));
      return;
    }
    const req = indexedDB.open(cfg.name, cfg.version);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of cfg.stores) {
        const store = db.objectStoreNames.contains(s.name)
          ? req.transaction?.objectStore(s.name)
          : db.createObjectStore(s.name, { keyPath: s.key });
        if (store && s.indexes) {
          for (const idx of s.indexes) {
            if (!store.indexNames.contains(idx)) store.createIndex(idx, idx);
          }
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
    req.onblocked = () => reject(new Error("IndexedDB open blocked"));
  });
  handles.set(cfg, p);
  return p;
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

function ensureCfg(cfg: IndexedDbCfg | undefined): cfg is IndexedDbCfg {
  return cfg !== undefined && Array.isArray(cfg.stores) && cfg.stores.length > 0;
}

export async function indexedRead(input: unknown, cfg?: IndexedDbCfg): Promise<EffectResult> {
  // `indexed.read` cap covers two spec-§6.7.4 effects that share the cap:
  // `indexed-read` (point lookup, returns Option) and `indexed-query` (range,
  // returns List). Dispatch by input shape — a `key` means point lookup.
  const x = input as { store: string; key?: unknown };
  if (x.key !== undefined) return pointRead(x as { store: string; key: string }, cfg);
  return indexedQuery(input, cfg);
}

async function pointRead(
  input: { store: string; key: string },
  cfg?: IndexedDbCfg,
): Promise<EffectResult> {
  if (!ensureCfg(cfg)) {
    return { kind: "err", value: { message: "app.indexed-db is not declared" } };
  }
  try {
    const db = await openDb(cfg);
    const tx = db.transaction(input.store, "readonly");
    const value = await reqToPromise(tx.objectStore(input.store).get(input.key));
    if (value === undefined) return { kind: "ok", value: _stdlibCore.None };
    return { kind: "ok", value: _stdlibCore.Some(value) };
  } catch (e) {
    return { kind: "err", value: { message: String(e) } };
  }
}

export async function indexedWrite(input: unknown, cfg?: IndexedDbCfg): Promise<EffectResult> {
  const { store, key, value } = input as { store: string; key: string; value: unknown };
  if (!ensureCfg(cfg)) {
    return { kind: "err", value: { message: "app.indexed-db is not declared" } };
  }
  try {
    const db = await openDb(cfg);
    const tx = db.transaction(store, "readwrite");
    const os = tx.objectStore(store);
    // Honor the store's declared keyPath: stamp it into the record so callers
    // don't need to repeat the id field in `value`.
    const record =
      value && typeof value === "object"
        ? { ...(value as Record<string, unknown>), [os.keyPath as string]: key }
        : value;
    await reqToPromise(os.put(record));
    return { kind: "ok", value: null };
  } catch (e) {
    return { kind: "err", value: { message: String(e) } };
  }
}

export async function indexedDelete(input: unknown, cfg?: IndexedDbCfg): Promise<EffectResult> {
  const { store, key } = input as { store: string; key: string };
  if (!ensureCfg(cfg)) {
    return { kind: "err", value: { message: "app.indexed-db is not declared" } };
  }
  try {
    const db = await openDb(cfg);
    const tx = db.transaction(store, "readwrite");
    await reqToPromise(tx.objectStore(store).delete(key));
    return { kind: "ok", value: null };
  } catch (e) {
    return { kind: "err", value: { message: String(e) } };
  }
}

export async function indexedQuery(input: unknown, cfg?: IndexedDbCfg): Promise<EffectResult> {
  const x = input as { store: string; index?: unknown; range?: unknown };
  if (!ensureCfg(cfg)) {
    return { kind: "err", value: { message: "app.indexed-db is not declared" } };
  }
  try {
    const db = await openDb(cfg);
    const tx = db.transaction(x.store, "readonly");
    const indexName = unwrapOption(x.index) as string | undefined;
    const range = toKeyRange(unwrapOption(x.range) as IndexRange | undefined);
    const source = indexName ? tx.objectStore(x.store).index(indexName) : tx.objectStore(x.store);
    const values = await reqToPromise(source.getAll(range));
    return { kind: "ok", value: values };
  } catch (e) {
    return { kind: "err", value: { message: String(e) } };
  }
}

function unwrapOption(v: unknown): unknown {
  // Kumiki's `Option(T)` lowers to `{ _tag: "Some", _0: T } | { _tag: "None" }`;
  // raw values pass through unchanged so plain JS callers still work.
  if (v && typeof v === "object" && "_tag" in v) {
    const tag = (v as { _tag: string })._tag;
    if (tag === "None") return undefined;
    if (tag === "Some") return (v as unknown as { _0: unknown })._0;
  }
  return v;
}

function toKeyRange(r: IndexRange | undefined): IDBKeyRange | undefined {
  if (!r) return undefined;
  const lower = unwrapOption(r.lower);
  const upper = unwrapOption(r.upper);
  if (lower !== undefined && upper !== undefined) {
    return IDBKeyRange.bound(
      lower as IDBValidKey,
      upper as IDBValidKey,
      r.lowerOpen ?? false,
      r.upperOpen ?? false,
    );
  }
  if (lower !== undefined)
    return IDBKeyRange.lowerBound(lower as IDBValidKey, r.lowerOpen ?? false);
  if (upper !== undefined)
    return IDBKeyRange.upperBound(upper as IDBValidKey, r.upperOpen ?? false);
  return undefined;
}
