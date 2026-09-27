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
    const { body, contentType } = encodeBody(x.body);
    if (body !== undefined) init.body = body;
    if (contentType && !hasHeader(headers, "Content-Type")) headers["Content-Type"] = contentType;
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

type Tagged = { _tag: string; _0?: unknown };

/**
 * What a request body is sent as, and the Content-Type it implies when the
 * program set none (http.md §6.1.3 / §6.1.5). An `HttpBody` variant is sent as
 * what it names; a `Multipart` / `Bytes` / `Text` body gets no Content-Type
 * here, so fetch writes its own (the multipart boundary in particular). Any
 * other value — a record, a list — is sent as JSON, and a JS string as-is.
 */
function encodeBody(body: unknown): { body?: BodyInit; contentType?: string } {
  if (typeof body === "string") return { body };
  const t = body as Tagged | null;
  switch (t !== null && typeof t === "object" ? t._tag : undefined) {
    case "Json":
      return { body: JSON.stringify(t?._0), contentType: "application/json" };
    case "Form":
      return {
        body: new URLSearchParams(t?._0 as Record<string, string>).toString(),
        contentType: "application/x-www-form-urlencoded",
      };
    case "Multipart":
      return { body: formDataOf(t?._0 as Record<string, unknown>) };
    case "Text":
      return { body: String(t?._0) };
    case "Bytes":
      return { body: t?._0 as BodyInit };
    case "Empty":
      return {};
    default:
      return { body: JSON.stringify(body), contentType: "application/json" };
  }
}

/** A `Multipart(Map(Text, FormValue))` as the `FormData` fetch encodes. */
function formDataOf(entries: Record<string, unknown>): FormData {
  const fd = new FormData();
  for (const [name, v] of Object.entries(entries ?? {})) {
    const inner = v !== null && typeof v === "object" && "_tag" in v ? (v as Tagged)._0 : v;
    // `FileV` carries the file record a file input produced; its DOM `File` is `_file`.
    const file = (inner as { _file?: unknown } | null)?._file ?? inner;
    if (file instanceof Blob) fd.append(name, file);
    else fd.append(name, String(inner));
  }
  return fd;
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const lower = name.toLowerCase();
  return Object.keys(headers).some((k) => k.toLowerCase() === lower);
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
