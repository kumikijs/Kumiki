// What a read's `Decoder` (http.md §6.1.4) makes of what it read: shipped only
// with the handlers that decode — storage, IndexedDB and HTTP.

import { type RefinementFailure, showRefinementFailure } from "./core.ts";

/**
 * What `Decoder.Json(T)` lowers to when `T` carries a predicate anywhere in it:
 * the walk a slot of type `T` is gated by (language.md §1.3.3), answering the
 * first predicate a value fails and where, or `undefined` when it passes. A
 * `T` with no predicate lowers to the `"json"` sentinel instead.
 */
export type DecodeCheck = (v: unknown) => RefinementFailure | undefined;

/** The sentinels `Decoder.Json` / `Decoder.Text` / `Decoder.Bytes` / `Decoder.None` lower to. */
const SENTINELS = ["json", "text", "bytes", "none"] as const;

/** A request's `decode`: a sentinel naming the decoding, or the check above. */
export type Decode = (typeof SENTINELS)[number] | DecodeCheck;

/**
 * The request's `decode` as a {@link Decode}. A request with none is `"json"`,
 * the default decoder.
 *
 * Anything else throws, naming the value. `map-request` builds an ordinary
 * record and nothing checks its `decode` against `Decoder`, so a program can
 * put any value there (`decode: "TEXT"`). Read as some fallback decoding, it
 * would deliver a value of whatever type that decoding produces, under an
 * effect that declares another, and nothing would report it.
 */
export function decodeOf(decode: unknown): Decode {
  if (decode === undefined || decode === null) return "json";
  if (typeof decode === "function") return decode as DecodeCheck;
  const sentinel = SENTINELS.find((s) => s === decode);
  if (sentinel) return sentinel;
  const shown = typeof decode === "string" ? JSON.stringify(decode) : String(decode);
  throw new Error(`decode is ${shown}, which is not a Decoder`);
}

/** Whether `decode` parses the body as JSON — the sentinel, or a `Decoder.Json(T)` check. */
export function decodesJson(decode: Decode): decode is "json" | DecodeCheck {
  return decode === "json" || typeof decode === "function";
}

/**
 * What a read holds before it is decoded, read only the way the decoder asks:
 * a response, or a stored text. Either read may throw (a body stream that
 * fails), and the throw is the caller's.
 */
export type Undecoded = { text(): Promise<string>; bytes(): Promise<Uint8Array> };

/**
 * A decoded value, or why the decoder refuses it: the `message` that starts
 * `decode failed:` and the text it refused, which an `HttpError` carries as
 * its `body`.
 */
export type Decoded = { ok: true; value: unknown } | { ok: false; message: string; text: string };

/**
 * What `decode` makes of `read` (http.md §6.1.4): `Decoder.Text` its text,
 * `Decoder.Bytes` its bytes (a `Uint8Array`, the runtime's `Bytes`),
 * `Decoder.None` `Unit` without reading it, and `Decoder.Json(T)` its text
 * parsed as JSON and checked against `T`. A text that does not parse, and a
 * parsed value `T` refuses, are each refused.
 */
export async function decodeRead(decode: Decode, read: Undecoded): Promise<Decoded> {
  if (decodesJson(decode)) {
    const text = await read.text();
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch (e) {
      return { ok: false, message: `decode failed: ${String(e)}`, text };
    }
    const refused = decodeRefusal(decode, value);
    return refused ? { ok: false, message: refused, text } : { ok: true, value };
  }
  switch (decode) {
    case "text":
      return { ok: true, value: await read.text() };
    case "bytes":
      return { ok: true, value: await read.bytes() };
    case "none":
      return { ok: true, value: null };
  }
}

/**
 * Why `decode` refuses a parsed value — `decode failed: uuid at .keys["k1"]`,
 * the whole `.err` of a storage-family read and the `message` of an HTTP
 * read's `HttpError` — or `undefined` when it accepts it.
 * The predicate and the path go through the formatter a refused reducer
 * write uses (runtime.md §10.3.3), since the value is refused by the same check.
 */
export function decodeRefusal(decode: Decode, value: unknown): string | undefined {
  const f = typeof decode === "function" ? decode(value) : undefined;
  if (!f) return undefined;
  return `decode failed: ${showRefinementFailure(f)}`;
}
