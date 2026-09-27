// storage.* / session.* built-in capability handlers (#71, #84):
// shipped only when an app declares a matching storage-backed effect.
// `storage-*` uses localStorage; `session-*` is the same shape over
// sessionStorage (spec §6.7.4). Both treat backend unavailability
// (opaque-origin sandbox, private mode, SecurityError) as a clean
// `err` result so reducers can opt into a `.err` branch (#37).

import type { EffectResult } from "./core.ts";
import { _stdlibCore } from "./stdlib.ts";

async function readFrom(storage: Storage, key: string): Promise<EffectResult> {
  try {
    const raw = storage.getItem(key);
    if (raw === null) return { kind: "ok", value: _stdlibCore.None };
    const value = JSON.parse(raw);
    return { kind: "ok", value: _stdlibCore.Some(value) };
  } catch (e) {
    return { kind: "err", value: { message: String(e) } };
  }
}

/**
 * One `*.write` capability answers the three declarations of http.md §6.7.2,
 * told apart by the request: `Unit` clears the storage, a `{key}` with no
 * `value` field removes the key, and `{key, value}` writes the value — whatever
 * it is, so a `None` or an empty list is still a write.
 */
async function writeTo(storage: Storage, input: unknown): Promise<EffectResult> {
  try {
    if (input === null || input === undefined) {
      storage.clear();
    } else {
      const req = input as { key: string; value?: unknown };
      if ("value" in req) storage.setItem(req.key, JSON.stringify(req.value) ?? "null");
      else storage.removeItem(req.key);
    }
    return { kind: "ok", value: null };
  } catch (e) {
    return { kind: "err", value: { message: String(e) } };
  }
}

export async function storageRead(input: unknown): Promise<EffectResult> {
  const { key } = input as { key: string };
  return readFrom(localStorage, key);
}

export async function storageWrite(input: unknown): Promise<EffectResult> {
  return writeTo(localStorage, input);
}

export async function sessionRead(input: unknown): Promise<EffectResult> {
  const { key } = input as { key: string };
  return readFrom(sessionStorage, key);
}

export async function sessionWrite(input: unknown): Promise<EffectResult> {
  return writeTo(sessionStorage, input);
}
