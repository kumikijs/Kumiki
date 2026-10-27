import { readFileSync } from "node:fs";
import { messageOf } from "./text.ts";

/** One scripted response. `json` and `text` are alternatives; `json` wins. */
export type HttpResponseFixture = {
  /** Default 200. */
  status?: number;
  /** Serialized as the body, with `content-type: application/json`. */
  json?: unknown;
  /** Body verbatim (UTF-8), for `Decoder.Text` / `Decoder.Bytes` / `Decoder.None`. */
  text?: string;
  headers?: Record<string, string>;
};

export type HttpFixture = Record<string, HttpResponseFixture | HttpResponseFixture[]>;

let currentFixture: HttpFixture | null = null;
let cursors: Record<string, number> = {};
let requestLog: string[] = [];

export function useHttpFixture(fixture: HttpFixture | null): void {
  currentFixture = fixture;
  cursors = {};
  requestLog = [];
}

export function httpRequests(): string[] {
  return [...requestLog];
}

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
    throw new Error(`${path} is not valid JSON: ${messageOf(e)}`);
  }
}

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
  const first = entry[0];
  if (first === undefined) {
    return { found: false, why: `its queue in the .http.json is empty` };
  }
  const idx = cursors[key] ?? 0;
  cursors[key] = idx + 1;
  return { found: true, response: entry[Math.min(idx, entry.length - 1)] ?? first };
}

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

export function clearStorage(): void {
  const page = globalThis as { localStorage?: Storage; sessionStorage?: Storage };
  page.localStorage?.clear();
  page.sessionStorage?.clear();
}
