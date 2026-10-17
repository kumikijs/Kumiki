import type { EffectResult } from "./core.ts";
import { type Decode, decodeRefusal } from "./effects-decode.ts";
import { _stdlibCore } from "./stdlib.ts";

type Backend = "localStorage" | "sessionStorage";

// No JSON text starts with it, so a text stored as plain JSON, whichever build
// wrote it, never reads as tagged.
const TAGGED = "~";

// The numbers JSON has no form for, each by the one spelling its `$float` tag takes.
const FLOATS = new Map([
  ["NaN", Number.NaN],
  ["Infinity", Number.POSITIVE_INFINITY],
  ["-Infinity", Number.NEGATIVE_INFINITY],
  ["-0", -0],
]);

// Standard base64, padded, as `btoa` writes it.
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function isUntagged(v: unknown): boolean {
  return typeof v === "number" && (!Number.isFinite(v) || Object.is(v, -0));
}

function tagOf(v: unknown): unknown {
  if (v instanceof Uint8Array) {
    return { $bytes: btoa(Array.from(v, (b) => String.fromCharCode(b)).join("")) };
  }
  if (isUntagged(v)) return { $float: Object.is(v, -0) ? "-0" : String(v) };
  return v;
}

/** Whether `v` holds, anywhere in it, a value JSON has no form for. */
function needsTags(v: unknown): boolean {
  if (v instanceof Uint8Array || isUntagged(v)) return true;
  if (v === null || typeof v !== "object") return false;
  return (Array.isArray(v) ? v : Object.values(v)).some(needsTags);
}

// An object key may start with `$` (a Map or Set of Text); one more `$` in front keeps it from
// reading as a tag.
function shiftKeys(v: unknown, shift: 1 | -1): unknown {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return v;
  const entries = Object.entries(v);
  if (!entries.some(([k]) => k.startsWith("$"))) return v;
  const shifted = (k: string) => (shift === 1 ? `$${k}` : k.slice(1));
  return Object.fromEntries(entries.map(([k, x]) => [k.startsWith("$") ? shifted(k) : k, x]));
}

function encodeStored(value: unknown): string | undefined {
  if (!needsTags(value)) return JSON.stringify(value);
  return (
    TAGGED +
    JSON.stringify(value, (_key, v: unknown) => {
      const tag = tagOf(v);
      return tag !== v ? tag : shiftKeys(v, 1);
    })
  );
}

// In the tagged form a key that starts with one `$` belongs to a tag, and a tag is exactly
// `{"$bytes": <base64>}` or `{"$float": <one of FLOATS>}`; anything else is not a stored value.
function untag(_key: string, v: unknown): unknown {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return v;
  const keys = Object.keys(v);
  const tag = keys.find((k) => k.startsWith("$") && !k.startsWith("$$"));
  if (tag === undefined) return shiftKeys(v, -1);
  const x = (v as Record<string, unknown>)[tag];
  if (keys.length === 1 && tag === "$bytes" && typeof x === "string" && BASE64.test(x)) {
    return Uint8Array.from(atob(x), (c) => c.charCodeAt(0));
  }
  if (keys.length === 1 && tag === "$float" && typeof x === "string" && FLOATS.has(x)) {
    return FLOATS.get(x);
  }
  throw new Error(`${JSON.stringify(v)} is not a tag`);
}

function decodeStored(raw: string): unknown {
  return raw.startsWith(TAGGED) ? JSON.parse(raw.slice(TAGGED.length), untag) : JSON.parse(raw);
}

async function readFrom(backend: Backend, input: unknown): Promise<EffectResult> {
  try {
    const { key, decode } = input as { key: string; decode?: Decode };
    const raw = globalThis[backend].getItem(key);
    if (raw === null) return { kind: "ok", value: _stdlibCore.None };
    let value: unknown;
    try {
      value = decodeStored(raw);
    } catch (e) {
      const at = JSON.stringify(key);
      return failed(
        `decode failed: the text under ${at} in ${backend} is not a stored value (${String(e)})`,
      );
    }
    const refused = decodeRefusal(decode, value);
    if (refused) return { kind: "err", value: refused };
    return { kind: "ok", value: _stdlibCore.Some(value) };
  } catch (e) {
    return { kind: "err", value: String(e) };
  }
}

/** An `err` whose value is the message itself, the declared `Text`. */
function failed(message: string): EffectResult {
  return { kind: "err", value: message };
}

function attempt(backend: Backend, call: string, run: (s: Storage) => void): EffectResult {
  try {
    run(globalThis[backend]);
    return { kind: "ok", value: null };
  } catch (e) {
    return failed(`${backend}.${call} failed: ${String(e)}`);
  }
}

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
