import { type RefinementFailure, showRefinementFailure } from "./core.ts";

export type DecodeCheck = (v: unknown) => RefinementFailure | undefined;

/** A request's `decode`: a sentinel naming the decoding, or the check above. */
export type Decode = string | DecodeCheck;

/** Whether `decode` parses the body as JSON — the sentinel, or a `Decoder.Json(T)` check. */
export function decodesJson(decode: Decode): boolean {
  return decode === "json" || typeof decode === "function";
}

export function decodeRefusal(decode: Decode | undefined, value: unknown): string | undefined {
  const f = typeof decode === "function" ? decode(value) : undefined;
  if (!f) return undefined;
  return `decode failed: ${showRefinementFailure(f)}`;
}
