// The check a `Decoder.Json(T)` carries (http.md §6.1.4): shipped only with
// the handlers that decode — storage, IndexedDB and HTTP.

import { type RefinementFailure, showRefinementFailure } from "./core.ts";

/**
 * What `Decoder.Json(T)` lowers to when `T` carries a predicate anywhere in it:
 * the walk a slot of type `T` is gated by (language.md §1.3.3), answering the
 * first predicate a value fails and where, or `undefined` when it passes. A
 * `T` with no predicate lowers to the `"json"` sentinel instead.
 */
export type DecodeCheck = (v: unknown) => RefinementFailure | undefined;

/** A request's `decode`: a sentinel naming the decoding, or the check above. */
export type Decode = string | DecodeCheck;

/** Whether `decode` parses the body as JSON — the sentinel, or a `Decoder.Json(T)` check. */
export function decodesJson(decode: Decode): boolean {
  return decode === "json" || typeof decode === "function";
}

/**
 * Why `decode` refuses a parsed value — `decode failed: uuid at .keys["k1"]`,
 * the whole `.err` of a storage-family read and the `message` of an HTTP
 * read's `HttpError` — or `undefined` when it accepts it.
 * The predicate and the path go through the formatter a refused reducer
 * write uses (runtime.md §10.3.3), since the value is refused by the same check.
 */
export function decodeRefusal(decode: Decode | undefined, value: unknown): string | undefined {
  const f = typeof decode === "function" ? decode(value) : undefined;
  if (!f) return undefined;
  return `decode failed: ${showRefinementFailure(f)}`;
}
