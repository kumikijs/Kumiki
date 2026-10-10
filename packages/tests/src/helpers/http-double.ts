import { vi } from "vitest";

export type FetchCall = { url: string; init: RequestInit };

export type FetchDouble = {
  /** Every call so far, in order. */
  calls: FetchCall[];
  /** Put back what was there before. Call it from `afterEach`. */
  restore: () => void;
};

/** Replace `globalThis.fetch` with a recorder that answers via `responder`. */
export function stubFetch(
  responder: (call: FetchCall) => Response | Promise<Response>,
): FetchDouble {
  const calls: FetchCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = typeof url === "string" ? url : (url as Request).url;
    const call: FetchCall = { url: u, init: init ?? {} };
    calls.push(call);
    return responder(call);
  }) as unknown as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

/**
 * Every value `fetch` was given for `name`, whatever the shape, matching the name case-insensitively as HTTP does — so a stray `content-type` beside a `Content-Type` shows up as two values instead of hiding.
 */
export function headerValues(h: HeadersInit | undefined, name: string): string[] {
  if (!h) return [];
  const entries =
    h instanceof Headers ? [...h.entries()] : Array.isArray(h) ? h : Object.entries(h);
  const lower = name.toLowerCase();
  return entries.filter(([k]) => k.toLowerCase() === lower).map(([, v]) => v);
}

/** One header out of whichever shape `fetch` was given, or `null`. Case-insensitive. */
export function readHeader(h: HeadersInit | undefined, name: string): string | null {
  const values = headerValues(h, name);
  return values.length === 0 ? null : values.join(", ");
}
