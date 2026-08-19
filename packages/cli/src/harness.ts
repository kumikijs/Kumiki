// Test doubles for the two headless verification tiers.
//
// `kumiki smoke` / `kumiki run` and the `@kumikijs/tests` suite drive the same
// runtime through the same examples, so they must see the same environment.
// Two pieces of that environment are not the DOM's to provide:
//
//   * `fetch` — an example that emits an http effect would otherwise reach the
//     real network. That makes a run depend on DNS, and `httpFetch` normalizes
//     every failure into an `HttpError`, so an app with an `.err` reducer
//     reports the outcome it was written to report and the tier stays green.
//   * `IntersectionObserver` — happy-dom ships one whose `observe()` never
//     notifies, so the runtime takes its IO branch and nothing ever fires.
//
// Both doubles are installed onto the current realm's globals, which is why
// this lives beside the CLI's happy-dom registration rather than in the
// runtime: the runtime must stay the thing under test.

import { readFileSync } from "node:fs";

/** One scripted response. `json` and `text` are alternatives; `json` wins. */
export type HttpResponseFixture = {
  /** Default 200. */
  status?: number;
  /** Serialized as the body, with `content-type: application/json`. */
  json?: unknown;
  /** Body verbatim, for `Decoder.Text()` / `Decoder.None`. */
  text?: string;
  headers?: Record<string, string>;
};

/**
 * Scripted responses for one example, keyed `"<METHOD> <path>"` — `path` as the
 * effect's `map-request` writes it, after the app's `base-url` is applied
 * (`https://api.example.com` + `/quote` is keyed `"GET /quote"`).
 *
 * A key may carry a queue instead of a single response, and the last entry
 * repeats: `[500, 500, 200]` is how a `retry=exponential` ladder becomes
 * observable. A key with a query string matches that exact query; a key
 * without one matches any.
 */
export type HttpFixture = Record<string, HttpResponseFixture | HttpResponseFixture[]>;

let currentFixture: HttpFixture | null = null;
let cursors: Record<string, number> = {};
let requestLog: string[] = [];

/**
 * Point the `fetch` double at one example's scripted responses. Passing `null`
 * leaves every request unfixtured, which is a reported failure rather than a
 * live request.
 */
export function useHttpFixture(fixture: HttpFixture | null): void {
  currentFixture = fixture;
  cursors = {};
  requestLog = [];
}

/**
 * Every request the double has *seen* since the fixture was set, answered or
 * not, as `"<METHOD> <path>"`. What a retry ladder or a `policy=latest`
 * cancellation actually did is otherwise invisible: the app reports the same
 * final state whether it took one attempt or three.
 */
export function httpRequests(): string[] {
  return [...requestLog];
}

/**
 * Read `<source>.http.json` beside a `.kumiki` file; `null` when there is none.
 *
 * Only a missing file means "no fixture". A permission error, or a directory in
 * its place, is a different problem, and swallowing it would send the author
 * looking for a file that is sitting right there — the miss message they would
 * eventually see says "add it to the example's .http.json".
 */
export function readHttpFixture(kumikiPath: string): HttpFixture | null {
  if (!kumikiPath.endsWith(".kumiki")) {
    throw new Error(`not a Kumiki source, so nothing sits beside it: ${kumikiPath}`);
  }
  const path = `${kumikiPath.slice(0, -".kumiki".length)}.http.json`;
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
  try {
    return JSON.parse(raw) as HttpFixture;
  } catch (e) {
    throw new Error(`${path} is not valid JSON: ${e instanceof Error ? e.message : e}`);
  }
}

/**
 * Install the doubles onto `globalThis`, replacing whatever is there. Call it
 * from a vitest setup file, and again after anything that rebuilds the realm —
 * `GlobalRegistrator.register` overwrites both globals, so a version that
 * installed only once would leave the second realm undoubled and the tier back
 * on the network. The fixture table is swapped per example by `useHttpFixture`.
 */
export function installTestDoubles(): void {
  installFetchDouble();
  installIntersectionObserverDouble();
}

function installFetchDouble(): void {
  const g = globalThis as unknown as { fetch: typeof fetch };
  g.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const target = new URL(url, "http://localhost/");
    requestLog.push(`${method} ${target.pathname}${target.search}`);
    const found = lookup(method, target);
    if (!found.found) {
      // Reported, not merely thrown: `httpFetch` turns every rejection into an
      // `HttpError`, so an app with an `.err` reducer would absorb this and the
      // run would pass having tested nothing. `smoke` fails on a captured
      // `console.error`, and so does `runScenario` — including during the mount
      // window, where an `app.init` effect fires.
      const key = `${method} ${target.pathname}${target.search}`;
      console.error(
        `no HTTP fixture for ${key} — ${found.why} (the headless tiers never reach the network)`,
      );
      throw new Error(`no HTTP fixture for ${key}`);
    }
    await waitATick(init?.signal ?? null);
    return toResponse(found.response);
  };
}

type Lookup =
  | { found: true; response: HttpResponseFixture }
  /** `why` is appended to the miss message, so an empty queue does not read as a missing key. */
  | { found: false; why: string };

/** Resolve one request to the next scripted response, advancing that key's queue. */
function lookup(method: string, target: URL): Lookup {
  const miss = { found: false as const, why: "add it to the example's .http.json" };
  if (!currentFixture) return miss;
  const withQuery = `${method} ${target.pathname}${target.search}`;
  const withoutQuery = `${method} ${target.pathname}`;
  const key = currentFixture[withQuery] !== undefined ? withQuery : withoutQuery;
  const entry = currentFixture[key];
  if (entry === undefined) return miss;
  if (!Array.isArray(entry)) return { found: true, response: entry };
  // The documented rule is that the last entry repeats, so an empty array is
  // the one way a queue can run out — named separately, because telling an
  // author to add a fixture they already wrote helps nobody.
  const first = entry[0];
  if (first === undefined) {
    return { found: false, why: `its queue in the .http.json is empty` };
  }
  const idx = cursors[key] ?? 0;
  cursors[key] = idx + 1;
  return { found: true, response: entry[Math.min(idx, entry.length - 1)] ?? first };
}

/**
 * One macrotask of latency, abortable. Without it a scripted response resolves
 * synchronously enough that `policy=latest`, `http.cancel` and the timeout path
 * never get to abort anything, and the tier would certify cancellation it never
 * exercised.
 */
function waitATick(signal: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, 0);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function abortError(): Error {
  const e = new Error("The operation was aborted.");
  e.name = "AbortError";
  return e;
}

function toResponse(fixture: HttpResponseFixture): Response {
  const headers: Record<string, string> = { ...(fixture.headers ?? {}) };
  let body: string | null = null;
  if (fixture.json !== undefined) {
    body = JSON.stringify(fixture.json);
    if (!headers["content-type"]) headers["content-type"] = "application/json";
  } else if (fixture.text !== undefined) {
    body = fixture.text;
  }
  const status = fixture.status ?? 200;
  // 204/205 carry no body per fetch, and constructing one with a body throws.
  return new Response(status === 204 || status === 205 ? null : body, { status, headers });
}

/**
 * happy-dom's `IntersectionObserver.observe()` is a no-op, so the runtime's
 * primary prefetch path (§3.8) never fires under it and the microtask fallback
 * never runs either — the feature is unreachable from both headless tiers.
 * This double reports every observed target as intersecting, on a microtask so
 * the caller returns before the callback re-enters render.
 */
function installIntersectionObserverDouble(): void {
  class IntersectingObserver {
    private readonly cb: IntersectionObserverCallback;
    readonly root = null;
    readonly rootMargin = "0px";
    readonly thresholds: readonly number[] = [0];
    constructor(cb: IntersectionObserverCallback) {
      this.cb = cb;
    }
    observe(target: Element): void {
      queueMicrotask(() => {
        const entry = { isIntersecting: true, target } as IntersectionObserverEntry;
        this.cb([entry], this as unknown as IntersectionObserver);
      });
    }
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver =
    IntersectingObserver as unknown as typeof IntersectionObserver;
}
