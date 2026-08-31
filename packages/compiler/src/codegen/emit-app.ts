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
  // Every field an author writes an expression for is deferred: `headers` as
  // the thunk the runtime calls, the three scalars as getters the runtime
  // reads. Both defer for the same reason — each is consulted when a request is
  // made, so a slot reference answers with the value that request is made with
  // rather than the default it was declared with.
  //
  // Deferring is also what keeps this config emittable before the slot table:
  // a getter body runs when the field is read, and `_live` is built by then.
  // As values, the three read a `const` that is still in its temporal dead zone
  // and the module threw on import.
  //
  // The shape does not depend on what was written — a literal gets a getter
  // too — so a program cannot be one that reads its config once.
  if (http.baseUrl) fields.push(`get baseUrl() { return ${jsOfExpr(http.baseUrl, ctx)}; }`);
  if (http.headers) fields.push(`headers: () => (${jsOfExpr(http.headers, ctx)})`);
  if (http.timeout) fields.push(`get timeout() { return ${jsOfExpr(http.timeout, ctx)}; }`);
  if (http.credentials)
    fields.push(`get credentials() { return ${jsOfExpr(http.credentials, ctx)}; }`);
  if (http.on401) fields.push(`on401: ${JSON.stringify(http.on401.name)}`);
  if (http.on403) fields.push(`on403: ${JSON.stringify(http.on403.name)}`);
  if (http.on5xx) fields.push(`on5xx: ${JSON.stringify(http.on5xx.name)}`);
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

/**
 * Lower one `app.init` entry to the `EmitSpec` the dispatcher consumes.
 *
 * A non-call entry is rejected by `checkApp` (E0104 `init-not-effect-call`), so
 * reaching the throw means a caller skipped `check` — which used to emit `null`
 * into the init array and let the dispatcher read `.effect` off it at mount.
 *
 * The arguments need the real `GenCtx`: without a slot table a slot reference
 * looks like an unknown local and lowers to a bare identifier, so
 * `init = [loadNote(noteKey)]` emitted `args: [noteKey]`. That lands in the app
 * object literal, so the failure is a `ReferenceError` at *import* — nothing
 * mounts. (The sibling site, `policyJs`, lowers into an arrow body and fails at
 * the first dispatch instead.) Scope is the plain non-reducer one, as in
 * `httpConfigJs`.
 *
 * Arguments are evaluated **once**, when `createApp()` builds the app object,
 * and the resulting array is never re-read: a later `app.live` change is not
 * reflected. What is in `_live` at that moment is each slot's declared default
 * — and NOT `route`, which every entry point installs after construction (the
 * DOM mount and the SSR pass alike). That is why the
 * checker rejects `route` here (E0120) instead of letting it lower to a read
 * of `undefined`, and why it walks these arguments in the same non-reducer
 * scope this function lowers them in: `_emits`, which an `emit` expression
 * lowers to, is a binding local to a reducer body and does not exist out here.
 */
export function emitFromInitExpr(e: Expr, gen: GenCtx): string {
  if (e.kind !== "Call") {
    throw new Error(`app.init entry is not an effect call (${e.kind})`);
  }
  const ctx = makeEvalCtx(gen, new Set(), false);
  return `{ effect: ${JSON.stringify(e.callee)}, args: [${e.args
    .map((a) => jsOfExpr(a, ctx))
    .join(", ")}] }`;
}
