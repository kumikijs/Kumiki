// storage.* / session.* built-in capability handlers (#71, #84):
// shipped only when an app declares a matching storage-backed effect.
// `storage-*` uses localStorage; `session-*` is the same shape over
// sessionStorage (http.md §6.7.4). Both treat backend unavailability
// (opaque-origin sandbox, private mode, SecurityError) as a clean
// `err` result so reducers can opt into a `.err` branch (#37). The err value
// is the failure's message as a plain string: the `Text` these effects
// declare as `E` in `out=Result(T, Text)` (http.md §6.7).

import type { EffectResult } from "./core.ts";
import { type Decode, decodeRefusal } from "./effects-decode.ts";
import { _stdlibCore } from "./stdlib.ts";

type Backend = "localStorage" | "sessionStorage";

/**
 * The first character of a stored text in the tagged form (http.md §6.7.2).
 * No JSON text starts with it, so a text stored as plain JSON, whichever build
 * wrote it, never reads as tagged.
 */
const TAGGED = "~";

/**
 * The tag a value JSON has no form for is written as in the tagged form — a
 * `Bytes` as its base64, a non-finite number as its name — or `v` itself.
 */
function tagOf(v: unknown): unknown {
  if (v instanceof Uint8Array) {
    return { $bytes: btoa(Array.from(v, (b) => String.fromCharCode(b)).join("")) };
  }
  if (typeof v === "number" && !Number.isFinite(v)) return { $float: String(v) };
  return v;
}

/**
 * `v` with one `$` added to (`shift` 1) or taken from (`shift` -1) each of its
 * own keys that starts with `$`, or `v` itself when it is not a plain object
 * or has no such key. A Map's `Text` key may start with `$`; escaped, it
 * starts with `$$`, so in the tagged form only a tag has a key that starts
 * with a single `$`.
 */
function shiftKeys(v: unknown, shift: 1 | -1): unknown {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return v;
  const entries = Object.entries(v);
  if (!entries.some(([k]) => k.startsWith("$"))) return v;
  const shifted = (k: string) => (shift === 1 ? `$${k}` : k.slice(1));
  return Object.fromEntries(entries.map(([k, x]) => [k.startsWith("$") ? shifted(k) : k, x]));
}

/**
 * The text `value` is stored as, or `undefined` when it has none (`undefined`
 * itself, a function). A value JSON holds is its JSON text. A value holding a
 * `Bytes` or a non-finite number anywhere is `~` followed by its JSON with
 * each of those written as its tag and each `$` key escaped.
 */
function encodeStored(value: unknown): string | undefined {
  let tagged = false;
  let escaped = false;
  const text = JSON.stringify(value, (_key, v: unknown) => {
    const tag = tagOf(v);
    if (tag !== v) {
      tagged = true;
      return tag;
    }
    const shifted = shiftKeys(v, 1);
    escaped ||= shifted !== v;
    return shifted;
  });
  if (tagged) return TAGGED + text;
  return escaped ? JSON.stringify(value) : text;
}

/** `JSON.parse`'s reviver for the tagged form: `tagOf` and the escape, undone. */
function untag(_key: string, v: unknown): unknown {
  if (v !== null && typeof v === "object" && Object.keys(v).length === 1) {
    const { $bytes, $float } = v as { $bytes?: unknown; $float?: unknown };
    if (typeof $bytes === "string") return Uint8Array.from(atob($bytes), (c) => c.charCodeAt(0));
    if (typeof $float === "string") return Number($float);
  }
  return shiftKeys(v, -1);
}

/** The value a stored text holds, in the tagged form or as plain JSON. */
function decodeStored(raw: string): unknown {
  return raw.startsWith(TAGGED) ? JSON.parse(raw.slice(TAGGED.length), untag) : JSON.parse(raw);
}

/**
 * The read of http.md §6.7.2. Everything that can throw is inside the `try`:
 * the backend's getter (it throws `SecurityError` in an opaque-origin
 * sandbox), the request itself (an `in=Unit` read with no `map-request` has
 * none) and a stored text that does not decode, so a failure is always the
 * `Text` err and never a rejection. A `Decoder.Json(T)` whose `T` refuses the
 * decoded value makes the read an `err` too.
 */
async function readFrom(backend: Backend, input: unknown): Promise<EffectResult> {
  try {
    const { key, decode } = input as { key: string; decode?: Decode };
    const raw = globalThis[backend].getItem(key);
    if (raw === null) return { kind: "ok", value: _stdlibCore.None };
    const value = decodeStored(raw);
    const refused = decodeRefusal(decode, value);
    if (refused) return { kind: "err", value: refused };
    return { kind: "ok", value: _stdlibCore.Some(value) };
  } catch (e) {
    return { kind: "err", value: String(e) };
  }
}

/** An `err` whose value is the message itself, the declared `Text` (http.md §6.7). */
function failed(message: string): EffectResult {
  return { kind: "err", value: message };
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
 * declared `in=Unit` with no `map-request`. A request that is not a record (an
 * empty one included), a key that is not a non-empty text, and a value with no
 * stored form are each an `err` that touches nothing.
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
  const raw = encodeStored(req.value);
  if (raw === undefined) {
    return failed(`${cap}: the value for ${at} cannot be stored (got ${String(req.value)})`);
  }
  return attempt(backend, `setItem(${at})`, (s) => s.setItem(key, raw));
}

export async function storageRead(input: unknown): Promise<EffectResult> {
  return readFrom("localStorage", input);
}

export async function storageWrite(input: unknown): Promise<EffectResult> {
  return writeTo("localStorage", "storage.write", input);
}

/** A `storage.write` declared `in=Unit` with no `map-request`: empties the origin's localStorage. */
export async function storageClear(): Promise<EffectResult> {
  return attempt("localStorage", "clear()", (s) => s.clear());
}

export async function sessionRead(input: unknown): Promise<EffectResult> {
  return readFrom("sessionStorage", input);
}

export async function sessionWrite(input: unknown): Promise<EffectResult> {
  return writeTo("sessionStorage", "session.write", input);
}

/** A `session.write` declared `in=Unit` with no `map-request`: empties the tab's sessionStorage. */
export async function sessionClear(): Promise<EffectResult> {
  return attempt("sessionStorage", "clear()", (s) => s.clear());
}
