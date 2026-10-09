import type { EffectResult } from "./core.ts";
import { type Decode, decodeRefusal, decodesJson } from "./effects-decode.ts";

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
    decode?: Decode;
    key?: string;
    value?: unknown;
  };
  const baseUrl = httpCfg?.baseUrl ?? "";
  const url = withQuery(baseUrl + (x.url ?? ""), x.query);
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
    if (body instanceof FormData) setHeader(headers, "Content-Type");
    else if (contentType && headerKey(headers, "Content-Type") === undefined) {
      headers["Content-Type"] = contentType;
    }
  }

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
