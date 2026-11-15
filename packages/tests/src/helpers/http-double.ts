import type { AppShape } from "@kumikijs/runtime";
import { expect, vi } from "vitest";
import { click, mountApp, waitUntil } from "./dom.ts";

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
 * Mount `app` with `fetch` answering `respond`, click the button whose whole text is `button`, and
 * return the one request that click made. `fetch` is put back before this returns.
 */
export async function sentRequest(
  app: AppShape,
  button: string,
  respond: () => Response,
): Promise<FetchCall> {
  const double = stubFetch(respond);
  const { root, handle } = mountApp(app);
  try {
    click(root, button);
    await waitUntil(() => double.calls.length > 0);
  } finally {
    handle.dispose();
    root.remove();
    double.restore();
  }
  expect(double.calls).toHaveLength(1);
  return double.calls[0] as FetchCall;
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

/** What `fetch` rejects with when the request's signal aborts. */
export const abortError = (): DOMException =>
  new DOMException("The operation was aborted.", "AbortError");

/** A responder {@link answerAfter} built, and what it has seen. */
export type TimedResponder = {
  respond: (call: FetchCall) => Promise<Response>;
  /** `performance.now()` when each call was made, in order. */
  madeAt: number[];
  /** How many calls it has answered. A call whose signal aborted first is not one of them. */
  answered: () => number;
};

/**
 * A responder that answers the `i`th call with `responses[i]` (the last one for every call past
 * the end), made from the call, `latencyMs` after the call is made. A call whose signal aborts
 * first rejects the way `fetch` does.
 */
export function answerAfter(
  latencyMs: number,
  responses: Array<(call: FetchCall) => Response>,
): TimedResponder {
  const madeAt: number[] = [];
  let answered = 0;
  return {
    madeAt,
    answered: () => answered,
    respond: (call) => {
      const make = responses[Math.min(madeAt.length, responses.length - 1)] as (
        call: FetchCall,
      ) => Response;
      madeAt.push(performance.now());
      const signal = call.init.signal;
      return new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(abortError());
        const h = setTimeout(() => {
          answered++;
          resolve(make(call));
        }, latencyMs);
        signal?.addEventListener("abort", () => {
          clearTimeout(h);
          reject(abortError());
        });
      });
    },
  };
}

/** A request {@link holdEach} is holding: where it went, its signal, and how to answer it. */
export type Held = {
  url: string;
  signal: AbortSignal | null | undefined;
  answer: (text: string) => void;
};

/**
 * A responder that answers nothing on its own. Each request waits in `held` until the test calls
 * its `answer`, and fails the way `fetch` does if its signal is aborted first.
 */
export function holdEach(held: Held[] = []): (call: FetchCall) => Promise<Response> {
  return (call) =>
    new Promise<Response>((resolve, reject) => {
      const signal = call.init.signal;
      held.push({ url: call.url, signal, answer: (text) => resolve(new Response(text)) });
      signal?.addEventListener("abort", () => reject(abortError()));
    });
}

/** The `i`th request `held` caught, or a failure naming the ones it did. */
export function heldAt(held: Held[], i: number): Held {
  const h = held[i];
  if (!h) throw new Error(`no request #${i} was made; made: ${held.map((x) => x.url).join(", ")}`);
  return h;
}
