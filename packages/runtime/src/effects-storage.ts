import type { EffectResult } from "./core.ts";
import { type Decode, decodeRefusal } from "./effects-decode.ts";
import { _stdlibCore } from "./stdlib.ts";

type Backend = "localStorage" | "sessionStorage";

async function readFrom(backend: Backend, input: unknown): Promise<EffectResult> {
  try {
    const { key, decode } = input as { key: string; decode?: Decode };
    const raw = globalThis[backend].getItem(key);
    if (raw === null) return { kind: "ok", value: _stdlibCore.None };
    const value = JSON.parse(raw);
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
  const raw: string | undefined = JSON.stringify(req.value);
  if (raw === undefined) {
    return failed(
      `${cap}: the value for ${at} cannot be stored as JSON (got ${String(req.value)})`,
    );
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
