// storage.* / session.* built-in capability handlers (#71, #84):
// shipped only when an app declares a matching storage-backed effect.
// `storage-*` uses localStorage; `session-*` is the same shape over
// sessionStorage (spec §6.7.4). Both treat backend unavailability
// (opaque-origin sandbox, private mode, SecurityError) as a clean
// `err` result so reducers can opt into a `.err` branch (#37).

import type { EffectResult } from "./core.ts";
import { type Decode, decodeRefusal } from "./effects-decode.ts";
import { _stdlibCore } from "./stdlib.ts";

/**
 * A stored value is JSON, so it is always parsed; a `Decoder.Json(T)` whose
 * `T` refuses what it parsed to makes the read an `err` (http.md §6.7.2), the
 * same way a value that does not parse does.
 */
async function readFrom(storage: Storage, key: string, decode?: Decode): Promise<EffectResult> {
  try {
    const raw = storage.getItem(key);
    if (raw === null) return { kind: "ok", value: _stdlibCore.None };
    const value = JSON.parse(raw);
    const refused = decodeRefusal(decode, value);
    if (refused) return { kind: "err", value: { message: refused } };
    return { kind: "ok", value: _stdlibCore.Some(value) };
  } catch (e) {
    return { kind: "err", value: { message: String(e) } };
  }
}

async function writeTo(storage: Storage, key: string, value: unknown): Promise<EffectResult> {
  try {
    storage.setItem(key, JSON.stringify(value));
    return { kind: "ok", value: null };
  } catch (e) {
    return { kind: "err", value: { message: String(e) } };
  }
}

export async function storageRead(input: unknown): Promise<EffectResult> {
  const { key, decode } = input as { key: string; decode?: Decode };
  return readFrom(localStorage, key, decode);
}

export async function storageWrite(input: unknown): Promise<EffectResult> {
  const { key, value } = input as { key: string; value: unknown };
  return writeTo(localStorage, key, value);
}

export async function sessionRead(input: unknown): Promise<EffectResult> {
  const { key, decode } = input as { key: string; decode?: Decode };
  return readFrom(sessionStorage, key, decode);
}

export async function sessionWrite(input: unknown): Promise<EffectResult> {
  const { key, value } = input as { key: string; value: unknown };
  return writeTo(sessionStorage, key, value);
}
