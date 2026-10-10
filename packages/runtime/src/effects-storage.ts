import type { EffectResult } from "./core.ts";
import { type Decode, decodeRefusal } from "./effects-decode.ts";
import { _stdlibCore } from "./stdlib.ts";

type Backend = "localStorage" | "sessionStorage";

// No JSON text starts with it, so a text stored as plain JSON, whichever build
// wrote it, never reads as tagged.
const TAGGED = "~";

function tagOf(v: unknown): unknown {
  if (v instanceof Uint8Array) {
    return { $bytes: btoa(Array.from(v, (b) => String.fromCharCode(b)).join("")) };
  }
  if (typeof v === "number" && !Number.isFinite(v)) return { $float: String(v) };
  return v;
}

// A Map's `Text` key may start with `$`; escaped to `$$`, it cannot be taken for a tag.
function shiftKeys(v: unknown, shift: 1 | -1): unknown {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return v;
  const entries = Object.entries(v);
  if (!entries.some(([k]) => k.startsWith("$"))) return v;
  const shifted = (k: string) => (shift === 1 ? `$${k}` : k.slice(1));
  return Object.fromEntries(entries.map(([k, x]) => [k.startsWith("$") ? shifted(k) : k, x]));
}

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

function untag(_key: string, v: unknown): unknown {
  if (v !== null && typeof v === "object" && Object.keys(v).length === 1) {
    const { $bytes, $float } = v as { $bytes?: unknown; $float?: unknown };
    if (typeof $bytes === "string") return Uint8Array.from(atob($bytes), (c) => c.charCodeAt(0));
    if (typeof $float === "string") return Number($float);
  }
  return shiftKeys(v, -1);
}

function decodeStored(raw: string): unknown {
  return raw.startsWith(TAGGED) ? JSON.parse(raw.slice(TAGGED.length), untag) : JSON.parse(raw);
}

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
