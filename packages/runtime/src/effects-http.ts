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

  const timeoutMs = httpCfg?.timeout ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  init.signal = controller.signal;

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
    return { kind: "err", value: { status: 0, message: String(e), body: "" } };
  } finally {
    clearTimeout(timer);
  }
}

function safeCallHeaders(thunk: () => Record<string, string>): Record<string, string> {
  try {
    return thunk() ?? {};
  } catch {
    return {};
  }
}
