// http.* built-in capability handler (#71): shipped only when an app declares
// an HTTP-backed effect.

import type { EffectResult } from "./core.ts";

export type HttpCfg = {
  baseUrl?: string;
  // `headers` is a thunk so slot references (e.g. an auth token) are
  // re-evaluated on every request rather than frozen at mount (spec #78).
  headers?: () => Record<string, string>;
  on401?: string;
  on403?: string;
  on5xx?: string;
  // Timeout in milliseconds; spec http.md §6.9 default is 30s.
  timeout?: number;
  // fetch credentials mode; spec http.md §6.9 default is "same-origin".
  credentials?: RequestCredentials;
};

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_CREDENTIALS: RequestCredentials = "same-origin";

export async function httpFetch(
  method: string,
  input: unknown,
  httpCfg?: HttpCfg,
  externalSignal?: AbortSignal,
): Promise<EffectResult> {
  const x = input as {
    url?: string;
    headers?: Record<string, string>;
    query?: Record<string, string>;
    body?: unknown;
    decode?: string;
    key?: string;
    value?: unknown;
  };
  const baseUrl = httpCfg?.baseUrl ?? "";
  const url = withQuery(baseUrl + (x.url ?? ""), x.query);
  // Header precedence (spec http.md §6.1.5): auto < global < input.
  const globalHeaders = httpCfg?.headers ? safeCallHeaders(httpCfg.headers) : {};
  const headers: Record<string, string> = { ...globalHeaders, ...(x.headers ?? {}) };
  const init: RequestInit = {
    method,
    headers,
    credentials: httpCfg?.credentials ?? DEFAULT_CREDENTIALS,
  };
  if (x.body !== undefined && method !== "GET" && method !== "HEAD") {
    if (typeof x.body === "string") {
      init.body = x.body;
    } else {
      init.body = JSON.stringify(x.body);
      if (!headers["Content-Type"]) headers["Content-Type"] = "application/json";
    }
  }

  // Internal controller drives the timeout; an external `signal` (from the
  // dispatcher / `http.cancel`) also aborts the in-flight fetch via the
  // listener below. `AbortSignal.any` would be ideal but is not in every
  // happy-dom / older browser target — manual fan-in is portable.
  const timeoutMs = httpCfg?.timeout ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  init.signal = controller.signal;
  let externallyAborted = false;
  const onExternalAbort = (): void => {
    externallyAborted = true;
    controller.abort();
  };
  if (externalSignal) {
    if (externalSignal.aborted) onExternalAbort();
    else externalSignal.addEventListener("abort", onExternalAbort);
  }

  try {
    const res = await fetch(url, init);
    if (res.status === 401 || res.status === 403 || res.status >= 500) {
      return {
        kind: "err",
        value: {
          status: res.status,
          message: res.statusText,
          body: await res.text().catch(() => ""),
        },
      };
    }
    if (!res.ok) {
      return {
        kind: "err",
        value: {
          status: res.status,
          message: res.statusText,
          body: await res.text().catch(() => ""),
        },
      };
    }
    const decode = x.decode ?? "json";
    if (decode === "none") return { kind: "ok", value: null };
    // Reading the body can still fail like a connection (it stays in the outer
    // catch, status 0). Parsing it cannot: a response arrived, so a decode
    // failure keeps its status and text (§6.1.4) and is not retried (§6.5).
    const text = await res.text();
    if (decode !== "json") return { kind: "ok", value: text };
    try {
      return { kind: "ok", value: JSON.parse(text) };
    } catch (e) {
      return {
        kind: "err",
        value: { status: res.status, message: `decode failed: ${String(e)}`, body: text },
      };
    }
  } catch (e) {
    // spec http.md §6.4.1: cancelled / aborted requests normalize to
    // `{status:0, message:"aborted"}` so reducers see the same HttpError
    // shape for manual cancel, `policy=latest` auto-cancel, and timeout.
    const aborted = externallyAborted || isAbortError(e);
    if (aborted) {
      return { kind: "err", value: { status: 0, message: "aborted", body: "" } };
    }
    return { kind: "err", value: { status: 0, message: String(e), body: "" } };
  } finally {
    clearTimeout(timer);
    if (externalSignal) externalSignal.removeEventListener("abort", onExternalAbort);
  }
}

/**
 * Append the request's `query` (http.md §6.1.2) to `url`: each entry
 * URL-encoded, after any query string the url already carries and before a
 * fragment. An empty or absent query leaves the url as written.
 */
function withQuery(url: string, query: Record<string, string> | undefined): string {
  const qs = new URLSearchParams(query ?? {}).toString();
  if (!qs) return url;
  const hash = url.indexOf("#");
  const path = hash < 0 ? url : url.slice(0, hash);
  const fragment = hash < 0 ? "" : url.slice(hash);
  const sep = !path.includes("?") ? "?" : path.endsWith("?") || path.endsWith("&") ? "" : "&";
  return path + sep + qs + fragment;
}

function isAbortError(e: unknown): boolean {
  if (e instanceof Error) {
    if (e.name === "AbortError") return true;
    if (/aborted/i.test(e.message)) return true;
  }
  return false;
}

/**
 * `app.http.headers` is an expression, evaluated per request. A throw from it
 * cannot take the request down — one bad header would otherwise mean no HTTP
 * at all — so the request goes out with no global headers.
 *
 * Reported, not swallowed. Dropping every global header silently is worse than
 * the throw: an app whose `Authorization` vanished gets a 401 and runs its
 * `on-401` reducer, so the visible symptom is a logout with no stated cause,
 * and the headless tiers (which decide failure from `console.error`) see a run
 * that passed. A `panic()` or a `.get` on a `None` in a header expression is
 * the same signal lifecycle.md §7.2 sends everywhere else, and it reaches the
 * console here too.
 */
function safeCallHeaders(thunk: () => Record<string, string>): Record<string, string> {
  try {
    return thunk() ?? {};
  } catch (e) {
    console.error(
      `app.http.headers threw — the request carries no global headers: ${e instanceof Error ? e.message : String(e)}`,
    );
    return {};
  }
}
