import { type RefinementFailure, showRefinementFailure } from "./core.ts";

export type DecodeCheck = (v: unknown) => RefinementFailure | undefined;

/** The sentinels `Decoder.Json` / `Decoder.Text` / `Decoder.Bytes` / `Decoder.None` lower to. */
const SENTINELS = ["json", "text", "bytes", "none"] as const;

/** A request's `decode`: a sentinel naming the decoding, or the check above. */
export type Decode = (typeof SENTINELS)[number] | DecodeCheck;

/** A `decode` that is none of the decoders, and the message naming it that the effect fails with. */
export type NotADecoder = { refused: string };

/**
 * A missing or `null` `decode` is JSON. Anything else that is no decoder is refused:
 * `map-request` builds an ordinary record, so `decode` can hold any value, and read as some
 * fallback decoding it would deliver a value of a type the effect does not declare, with nothing
 * reporting it.
 */
export function decodeOf(decode: unknown): Decode | NotADecoder {
  if (decode === undefined || decode === null) return "json";
  if (typeof decode === "function") return decode as DecodeCheck;
  const sentinel = SENTINELS.find((s) => s === decode);
  if (sentinel) return sentinel;
  return { refused: `decode is ${shown(decode)}, which is not a Decoder` };
}

/** `value` as JSON writes it, or its `typeof` where JSON has no text for it. */
function shown(value: unknown): string {
  try {
    return JSON.stringify(value) ?? typeof value;
  } catch {
    return typeof value;
  }
}

/** Whether `decode` parses the body as JSON — the sentinel, or a `Decoder.Json(T)` check. */
export function decodesJson(decode: Decode): decode is "json" | DecodeCheck {
  return decode === "json" || typeof decode === "function";
}

/** What a read holds before it is decoded, read only the way the decoder asks. */
export type Undecoded = {
  text: () => Promise<string>;
  bytes: () => Promise<Uint8Array>;
  /** How a JSON decoding parses the text, for a read that stores a form of its own. */
  parse?: (text: string) => unknown;
  /** What a text `parse` throws on is reported as, after `decode failed: `. */
  unparsed?: (e: unknown) => string;
};

/** The refused `text` is what an `HttpError` carries as its `body`. */
export type Decoded = { ok: true; value: unknown } | { ok: false; message: string; text: string };

export async function decodeRead(decode: Decode, read: Undecoded): Promise<Decoded> {
  if (decodesJson(decode)) {
    const text = await read.text();
    const parse = read.parse ?? JSON.parse;
    let value: unknown;
    try {
      value = parse(text);
    } catch (e) {
      const why = read.unparsed ? read.unparsed(e) : String(e);
      return { ok: false, message: `decode failed: ${why}`, text };
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
