import { type RefinementFailure, showRefinementFailure } from "./core.ts";

export type DecodeCheck = (v: unknown) => RefinementFailure | undefined;

/** The sentinels `Decoder.Json` / `Decoder.Text` / `Decoder.Bytes` / `Decoder.None` lower to. */
const SENTINELS = ["json", "text", "bytes", "none"] as const;

/** A request's `decode`: a sentinel naming the decoding, or the check above. */
export type Decode = (typeof SENTINELS)[number] | DecodeCheck;

/**
 * Anything but a decoder throws: `map-request` builds an ordinary record, so `decode` can hold any
 * value, and read as some fallback decoding it would deliver a value of a type the effect does not
 * declare, with nothing reporting it.
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

/** What a read holds before it is decoded, read only the way the decoder asks. */
export type Undecoded = { text(): Promise<string>; bytes(): Promise<Uint8Array> };

/** The refused `text` is what an `HttpError` carries as its `body`. */
export type Decoded = { ok: true; value: unknown } | { ok: false; message: string; text: string };

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

export function decodeRefusal(decode: Decode, value: unknown): string | undefined {
  const f = typeof decode === "function" ? decode(value) : undefined;
  if (!f) return undefined;
  return `decode failed: ${showRefinementFailure(f)}`;
}
