import { abortedHttpError, type EffectResult, type HttpError, NONE, someOf } from "./core.ts";
import { type Decode, decodeOf, decodeRead, decodesJson } from "./effects-decode.ts";

export type HttpCfg = {
  baseUrl?: string;
  headers?: () => Record<string, string>;
  on401?: string;
  on403?: string;
  on5xx?: string;
  timeout?: number;
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
    decode?: unknown;
    key?: string;
    value?: unknown;
  };
  const base = httpCfg?.baseUrl ?? "";
  // `map-request` is not checked against the request type, so a url can be any value.
  const url = withQuery(joinBase(base, String(x.url ?? "")), x.query);
  // Under a base, the program's own headers and credentials stay on the base's origin.
  const global = base === "" || sameOrigin(url, base);
  let decode: Decode;
  try {
    decode = decodeOf(x.decode);
  } catch (e) {
    return { kind: "err", value: httpError(0, errorText(e)) };
  }
  let encoded: Encoded = {};
  if (x.body !== undefined && method !== "GET" && method !== "HEAD") {
    try {
      encoded = encodeBody(x.body);
    } catch (e) {
      // A body that cannot be sent as written fails the effect, before any request.
      return { kind: "err", value: httpError(0, errorText(e)) };
    }
  }
  const headers: Record<string, string> = {};
  const layers = [
    defaultHeaders(decode, encoded.contentType),
    global && httpCfg?.headers ? safeCallHeaders(httpCfg.headers) : {},
    x.headers ?? {},
  ];
  // A value the types rule out but a lax decoder let through as `undefined` sets nothing, so it
  // never removes a lower layer's header.
  for (const layer of layers) {
    for (const [k, v] of Object.entries(layer)) if (v !== undefined) setHeader(headers, k, v);
  }
  // A `FormData` body's Content-Type must carry the boundary only fetch knows.
  if (encoded.body instanceof FormData) setHeader(headers, "Content-Type");
  const init: RequestInit = {
    method,
    headers,
    credentials: (global ? httpCfg?.credentials : undefined) ?? DEFAULT_CREDENTIALS,
  };
  if (encoded.body !== undefined) init.body = encoded.body;

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

  let res: Response | undefined;
  try {
    res = await fetch(url, init);
    // 401 / 403 / 5xx too: the dispatcher routes them to `app.http`'s handlers by status.
    if (!res.ok) {
      const body = await res.text().catch(() => undefined);
      // The dispatcher delivers what this returns, so a cancel or timeout during the read must
      // not reach `.err` as the status, which would fire `app.http`'s handler for it.
      if (body === undefined && controller.signal.aborted) {
        return { kind: "err", value: abortedHttpError() };
      }
      return { kind: "err", value: httpError(res.status, res.statusText, body) };
    }
    const decoded = await decodeRead(decode, {
      text: () => res.text(),
      bytes: async () => new Uint8Array(await res.arrayBuffer()),
    });
    if (decoded.ok) return { kind: "ok", value: decoded.value };
    return { kind: "err", value: httpError(res.status, decoded.message, decoded.text) };
  } catch (e) {
    const aborted = externallyAborted || isAbortError(e);
    if (aborted) return { kind: "err", value: abortedHttpError() };
    // A response that arrived keeps its status, so a 2xx whose body read failed is not retried:
    // the server already took the request.
    return { kind: "err", value: httpError(res?.status ?? 0, String(e)) };
  } finally {
    clearTimeout(timer);
    if (externalSignal) externalSignal.removeEventListener("abort", onExternalAbort);
  }
}

/** An omitted `body` is `None`. */
export function httpError(status: number, message: string, body?: string): HttpError {
  return { status, message, body: body === undefined ? NONE : someOf(body) };
}

type Tagged = { _tag: string; _0?: unknown };
type Encoded = { body?: BodyInit; contentType?: string };

// No `User-Agent`: a browser does not reliably let a script set it.
function defaultHeaders(decode: Decode, contentType?: string): Record<string, string> {
  const headers: Record<string, string> = {};
  if (decodesJson(decode)) headers.Accept = "application/json";
  if (contentType) headers["Content-Type"] = contentType;
  return headers;
}

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

const ABSOLUTE_URL = /^(?:[a-zA-Z][a-zA-Z0-9+.-]*:|\/\/)/;

// The base is a prefix, not a URL to resolve against: `new URL("/users", base)`
// would drop the base's own path.
function joinBase(base: string, url: string): string {
  if (/[?#]/.test(base) || url === "" || url.startsWith("?") || url.startsWith("#")) {
    return base + url;
  }
  if (!base || ABSOLUTE_URL.test(url)) return url;
  const trimmed = base.replace(/\/+$/, "");
  return url.startsWith("/") ? trimmed + url : `${trimmed}/${url}`;
}

// A relative url and a path-only base both resolve against the page; with no http(s) page, as on
// a server, against one placeholder origin, so they still agree with each other.
function sameOrigin(url: string, base: string): boolean {
  const href = (globalThis as { location?: { href?: string } }).location?.href;
  const page = href && /^https?:/i.test(href) ? href : "http://localhost/";
  try {
    return new URL(url, page).origin === new URL(base, page).origin;
  } catch {
    return false;
  }
}

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
