import type { AppDef, Expr } from "../ast.ts";
import { type GenCtx, makeEvalCtx } from "./context.ts";
import { jsOfExpr } from "./expr.ts";

export function httpConfigJs(http: AppDef["http"], gen: GenCtx): string {
  if (!http) return "const _http = undefined;";
  // Plain (non-reducer) scope: slot refs lower to `_live[name]`, not
  // `_next[name] ?? _live[name]` — `_next` is local to each reducer's
  // generated body and out of reach from `_http`'s closures.
  const ctx = makeEvalCtx(gen, new Set(), false);
  const fields: string[] = [];
  if (http.baseUrl) fields.push(`baseUrl: ${jsOfExpr(http.baseUrl, ctx)}`);
  if (http.headers) fields.push(`headers: () => (${jsOfExpr(http.headers, ctx)})`);
  if (http.timeout) fields.push(`timeout: ${jsOfExpr(http.timeout, ctx)}`);
  if (http.credentials) fields.push(`credentials: ${jsOfExpr(http.credentials, ctx)}`);
  if (http.on401) fields.push(`on401: ${JSON.stringify(http.on401)}`);
  if (http.on403) fields.push(`on403: ${JSON.stringify(http.on403)}`);
  if (http.on5xx) fields.push(`on5xx: ${JSON.stringify(http.on5xx)}`);
  return `const _http = { ${fields.join(", ")} };`;
}

// ----- app.indexed-db (#79) -----

export function indexedDbConfigJs(idb: AppDef["indexedDb"]): string {
  if (!idb) return "const _idb = undefined;";
  return `const _idb = ${JSON.stringify({ name: idb.name, version: idb.version, stores: idb.stores })};`;
}

// ----- app.meta / app.analytics (#80) -----

export function appMetaJson(meta: NonNullable<AppDef["meta"]>): Record<string, string> {
  const out: Record<string, string> = {};
  if (meta.title !== undefined) out.title = meta.title;
  if (meta.description !== undefined) out.description = meta.description;
  if (meta.ogImage !== undefined) out.ogImage = meta.ogImage;
  if (meta.favicon !== undefined) out.favicon = meta.favicon;
  return out;
}

export function appAnalyticsJson(
  analytics: NonNullable<AppDef["analytics"]>,
): Record<string, string> {
  const out: Record<string, string> = { provider: analytics.provider };
  if (analytics.appId !== undefined) out.appId = analytics.appId;
  return out;
}

export function emitFromInitExpr(e: Expr): string {
  if (e.kind === "Call") {
    return `{ effect: ${JSON.stringify(e.callee)}, args: [${e.args
      .map((a) => jsOfExpr(a, { gen: {} as GenCtx, localBinds: new Set() }))
      .join(", ")}] }`;
  }
  return "null";
}
