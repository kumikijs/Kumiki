// storage.* / session.* built-in capability handlers (#71, #84):
// shipped only when an app declares a matching storage-backed effect.
// `storage-*` uses localStorage; `session-*` is the same shape over
// sessionStorage (spec §6.7.4). Both treat backend unavailability
// (opaque-origin sandbox, private mode, SecurityError) as a clean
// `err` result so reducers can opt into a `.err` branch (#37).

import type { EffectResult } from "./core.ts";
import { _stdlibCore } from "./stdlib.ts";

type Backend = "localStorage" | "sessionStorage";

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

function failed(message: string): EffectResult {
  return { kind: "err", value: { message } };
}

/**
 * Run one Web Storage call, answering a failure as an `err` that names the call
 * and its key: a quota error on one key must read differently from a program
 * that built the wrong request.
 */
function attempt(backend: Backend, call: string, run: (s: Storage) => void): EffectResult {
  try {
    run(globalThis[backend]);
    return { kind: "ok", value: null };
  } catch (e) {
    return failed(`${backend}.${call} failed: ${String(e)}`);
  }
}

/**
 * The write and the remove of http.md §6.7.2, told apart by the request: a
 * record with a `value` field writes it — whatever it is, so a `None` or an
 * empty list is still a write — and one without removes the key. The clear is
 * not decided here: codegen calls `storageClear` / `sessionClear` for an effect
 * declared `in=Unit` with no `map-request`. An empty request is also what a Map
 * index that found nothing produces, so a request that is not a record, a key
 * that is not a non-empty text, and a value JSON cannot encode are each an
 * `err` that touches nothing.
 */
function writeTo(backend: Backend, cap: string, input: unknown): EffectResult {
  if (typeof input !== "object" || input === null) {
    return failed(`${cap}: the request is not a record (got ${String(input)})`);
  }
  const req = input as { key?: unknown; value?: unknown };
  const key = req.key;
  if (typeof key !== "string" || key === "") {
    return failed(`${cap}: a write or a remove needs a non-empty text key (got ${String(key)})`);
  }
  const at = JSON.stringify(key);
  if (!("value" in req)) return attempt(backend, `removeItem(${at})`, (s) => s.removeItem(key));
  // `JSON.stringify` answers `undefined` (not a string) for `undefined`, a
  // function or a symbol; stored, that would read back as something else.
  const raw: string | undefined = JSON.stringify(req.value);
  if (raw === undefined) {
    return failed(
      `${cap}: the value for ${at} cannot be stored as JSON (got ${String(req.value)})`,
    );
  }
  return attempt(backend, `setItem(${at})`, (s) => s.setItem(key, raw));
}

export async function storageRead(input: unknown): Promise<EffectResult> {
  const { key } = input as { key: string };
  return readFrom(localStorage, key);
}

export async function storageWrite(input: unknown): Promise<EffectResult> {
  return writeTo("localStorage", "storage.write", input);
}

/** A `storage.write` declared `in=Unit` with no `map-request`: empties the origin's localStorage. */
export async function storageClear(): Promise<EffectResult> {
  return attempt("localStorage", "clear()", (s) => s.clear());
}

export async function sessionRead(input: unknown): Promise<EffectResult> {
  const { key } = input as { key: string };
  return readFrom(sessionStorage, key);
}

export async function sessionWrite(input: unknown): Promise<EffectResult> {
  return writeTo("sessionStorage", "session.write", input);
}

/** A `session.write` declared `in=Unit` with no `map-request`: empties the tab's sessionStorage. */
export async function sessionClear(): Promise<EffectResult> {
  return attempt("sessionStorage", "clear()", (s) => s.clear());
}
