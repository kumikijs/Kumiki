// http.* built-in capability handler (#71): shipped only when an app declares
// an HTTP-backed effect.

import type { EffectResult } from "./core.ts";
import { type Decode, decodeRefusal, decodesJson } from "./effects-decode.ts";

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
    decode?: Decode;
    key?: string;
    value?: unknown;
  };
  const baseUrl = baseBefore(x.url ?? "", httpCfg?.baseUrl ?? "");
  const url = withQuery(baseUrl + (x.url ?? ""), x.query);
  // Header precedence (spec http.md §6.1.5): auto < global < input, with
  // names compared case-insensitively so a global `Content-Type` and an input
  // `content-type` do not both reach fetch.
  const headers: Record<string, string> = {};
  const globalHeaders = httpCfg?.headers ? safeCallHeaders(httpCfg.headers) : {};
  for (const [k, v] of Object.entries(globalHeaders)) setHeader(headers, k, v);
  for (const [k, v] of Object.entries(x.headers ?? {})) setHeader(headers, k, v);
  const init: RequestInit = {
    method,
    headers,
    credentials: httpCfg?.credentials ?? DEFAULT_CREDENTIALS,
  };
  if (x.body !== undefined && method !== "GET" && method !== "HEAD") {
    let encoded: Encoded;
    try {
      encoded = encodeBody(x.body);
    } catch (e) {
      // A body that cannot be sent as written fails the effect, before any request.
      return { kind: "err", value: { status: 0, message: errorText(e), body: "" } };
    }
    const { body, contentType } = encoded;
    if (body !== undefined) init.body = body;
    // A `FormData` body's Content-Type must carry the boundary only fetch
    // knows, so one the program set is dropped (§6.1.5).
    if (body instanceof FormData) setHeader(headers, "Content-Type");
    else if (contentType && headerKey(headers, "Content-Type") === undefined) {
      headers["Content-Type"] = contentType;
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
    // catch, status 0). Decoding it cannot: a response arrived, so a body that
    // does not parse, or parses to a value `Decoder.Json(T)`'s `T` refuses,
    // keeps its status and text (§6.1.4) and is not retried (§6.5).
    const text = await res.text();
    if (!decodesJson(decode)) return { kind: "ok", value: text };
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch (e) {
      return {
        kind: "err",
        value: { status: res.status, message: `decode failed: ${String(e)}`, body: text },
      };
    }
    const refused = decodeRefusal(decode, value);
    if (refused)
      return { kind: "err", value: { status: res.status, message: refused, body: text } };
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
type Encoded = { body?: BodyInit; contentType?: string };

/**
 * What a request body is sent as, and the Content-Type it implies when the
 * program set none (http.md §6.1.3 / §6.1.5). An `HttpBody` variant is sent as
 * what it names; a `Multipart` / `Bytes` / `Text` body gets no Content-Type
 * here, so fetch writes its own (the multipart boundary in particular). Any
 * other value — a record, a list, a bare `Text` — is sent as JSON. Throws when
 * the body cannot be sent as written (a `FileV` that holds no file).
 */
function encodeBody(body: unknown): Encoded {
  const t = body as Tagged | null;
  switch (t !== null && typeof t === "object" ? t._tag : undefined) {
    case "Json":
      // `Json` of Unit carries no value; it is sent as JSON `null`, never as an
      // empty body under a JSON Content-Type.
      return { body: JSON.stringify(t?._0 ?? null), contentType: "application/json" };
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
    const tagged = v !== null && typeof v === "object" && "_tag" in v ? (v as Tagged) : undefined;
    const inner = tagged ? tagged._0 : v;
    if (tagged?._tag === "FileV") {
      // `FileV` carries the file record a file input produced; its DOM `File`
      // is `_file`. A record that lost it (`{}` after a JSON round trip
      // through persistence) has nothing to upload.
      const file = (inner as { _file?: unknown } | null)?._file ?? inner;
      if (!(file instanceof Blob)) throw new Error(`Multipart field "${name}" holds no file`);
      fd.append(name, file);
    } else fd.append(name, String(inner));
  }
  return fd;
}

/** The key `headers` holds `name` under, compared case-insensitively. */
function headerKey(headers: Record<string, string>, name: string): string | undefined {
  const lower = name.toLowerCase();
  return Object.keys(headers).find((k) => k.toLowerCase() === lower);
}

/** Set `name` to `value`, or remove it, replacing it under whatever case it has. */
function setHeader(headers: Record<string, string>, name: string, value?: string): void {
  const old = headerKey(headers, name);
  if (old !== undefined) delete headers[old];
  if (value !== undefined) headers[name] = value;
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** A url that starts with a scheme (`https:`, `mailto:`) or with `//` (http.md §6.3.1). */
const ABSOLUTE_URL = /^(?:[a-zA-Z][a-zA-Z0-9+.-]*:|\/\/)/;

/**
 * What `app.http.base-url` puts in front of a request's `url` (http.md §6.3.1):
 * nothing when there is no base or the url is absolute; the base as written
 * when the url is empty or starts with `?` or `#`; otherwise the base without
 * its trailing `/`, plus a `/` when the url does not start with one, so exactly
 * one `/` separates the two. The base is a prefix, so a path it carries stays:
 * `https://api.example.com/v1` before `/users` is `https://api.example.com/v1/users`,
 * where resolving against the base (`new URL("/users", base)`) would drop `/v1`.
 */
function baseBefore(url: string, base: string): string {
  if (!base || ABSOLUTE_URL.test(url)) return "";
  if (url === "" || url.startsWith("?") || url.startsWith("#")) return base;
  const trimmed = base.replace(/\/+$/, "");
  return url.startsWith("/") ? trimmed : `${trimmed}/`;
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
      `app.http.headers threw — the request carries no global headers: ${errorText(e)}`,
    );
    return {};
  }
}
