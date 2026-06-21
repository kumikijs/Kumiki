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
    body?: unknown;
    decode?: string;
    key?: string;
    value?: unknown;
  };
  const baseUrl = httpCfg?.baseUrl ?? "";
  const url = baseUrl + (x.url ?? "");
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
    let value: unknown;
    if (decode === "json") value = await res.json();
    else if (decode === "text") value = await res.text();
    else if (decode === "none") value = null;
    else value = await res.text();
    return { kind: "ok", value };
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

function isAbortError(e: unknown): boolean {
  if (e instanceof Error) {
    if (e.name === "AbortError") return true;
    if (/aborted/i.test(e.message)) return true;
  }
  return false;
}

function safeCallHeaders(thunk: () => Record<string, string>): Record<string, string> {
  try {
    return thunk() ?? {};
  } catch {
    return {};
  }
}
