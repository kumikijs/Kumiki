import type { AppDef, Expr } from "../ast.ts";
import { STANDARD_CAPABILITIES } from "../capabilities.ts";
import { checkAgainst, checkEmitTarget } from "./against.ts";
import { type Ctx, type KumikiError, pureScope, type SymbolTable } from "./context.ts";
import { checkExpr, pushMismatch } from "./expr.ts";
import { container, prim } from "./infer.ts";
import {
  type RouteChainResolver,
  routeInAppInitMessage,
  routeReachedThroughCalls,
  servesNotFound,
} from "./route-chain.ts";
import { checkRedirects, checkRouteTargetArity } from "./tile.ts";

export function checkApp(
  app: AppDef,
  sym: SymbolTable,
  errors: KumikiError[],
  registeredCaps: Set<string>,
  routeChain: RouteChainResolver,
): void {
  for (const cap of app.caps) {
    if (!STANDARD_CAPABILITIES.has(cap) && !registeredCaps.has(cap)) {
      errors.push({
        code: "E0302",
        kind: "unknown-capability",
        message: `Unknown capability "${cap}" in app.caps — use a standard capability or register it in kumiki.caps.json`,
        pos: app.pos,
      });
    }
  }
  for (const r of app.routes) {
    if (r.tile.startsWith(">>")) continue; // redirect
    if (!sym.tiles.has(r.tile)) {
      errors.push({
        code: "E0105",
        kind: "undef-tile",
        message: `Route "${r.path}" targets undefined tile "${r.tile}"`,
        pos: app.pos,
      });
    }
    checkRouteTargetArity(r, `Route "${r.path}"`, sym, errors);
  }
  checkRedirects(app.routes, errors);
  if (!servesNotFound(app.routes)) {
    errors.push({
      code: "E0001",
      kind: "missing-404",
      message: `app.routes must include a "/404" entry`,
      pos: app.pos,
    });
  }
  const initCtx: Ctx = {
    kind: "app-init",
    localBinds: new Set(),
    localTypes: new Map(),
    capsAvailable: new Set(app.caps),
    routeBind: "unbound",
  };
  for (const e of app.init) {
    if (e.kind !== "Call") {
      errors.push({
        code: "E0104",
        kind: "init-not-effect-call",
        message: "app.init entries must be effect calls",
        pos: e.pos,
      });
      continue;
    }
    checkEmitTarget(e.callee, e.args, sym, errors, initCtx, e.pos);
    for (const a of e.args) {
      checkExpr(a, sym, errors, initCtx);
      for (const hop of routeReachedThroughCalls(a, sym, routeChain)) {
        errors.push({
          code: "E0120",
          kind: "route-in-app-init",
          message: routeInAppInitMessage(hop.name, hop.chain),
          pos: hop.pos,
        });
      }
    }
  }
  checkAppHttp(app, sym, errors);
  checkAppTheme(app, sym, errors);
}

function checkAppHttp(app: AppDef, sym: SymbolTable, errors: KumikiError[]): void {
  const http = app.http;
  if (!http) return;
  for (const handler of [http.on401, http.on403, http.on5xx]) {
    if (handler === undefined || sym.reducers.has(handler.name)) continue;
    errors.push({
      code: "E0102",
      kind: "undef-reducer",
      message: `Reference to undefined reducer "${handler.name}"`,
      pos: handler.pos,
    });
  }
  const fieldCtx = pureScope([]);
  for (const e of [http.baseUrl, http.headers, http.timeout, http.credentials]) {
    if (e !== undefined) checkExpr(e, sym, errors, fieldCtx);
  }
  if (http.baseUrl !== undefined)
    checkAgainst(http.baseUrl, prim("Text", http.baseUrl.pos), sym, errors, fieldCtx);
  if (http.headers !== undefined) {
    const pos = http.headers.pos;
    const text = prim("Text", pos);
    checkAgainst(http.headers, container("Map", [text, text], pos), sym, errors, fieldCtx);
  }
  if (http.timeout !== undefined)
    checkAgainst(http.timeout, prim("Int", http.timeout.pos), sym, errors, fieldCtx);
  if (http.credentials !== undefined) checkHttpCredentials(http.credentials, sym, errors, fieldCtx);
}

/** The `RequestCredentials` modes of the Fetch standard. */
const HTTP_CREDENTIALS = ["omit", "same-origin", "include"];

function checkHttpCredentials(e: Expr, sym: SymbolTable, errors: KumikiError[], ctx: Ctx): void {
  if (e.kind === "IfExpr") {
    checkHttpCredentials(e.consequent, sym, errors, ctx);
    checkHttpCredentials(e.alternate, sym, errors, ctx);
    return;
  }
  if (e.kind === "Str") {
    if (HTTP_CREDENTIALS.includes(e.value)) return;
    pushMismatch(
      errors,
      "E0201",
      `credentials "${e.value}" is not one of ${HTTP_CREDENTIALS.join(" / ")}; a browser refuses the request`,
      e.pos,
    );
    return;
  }
  checkAgainst(e, prim("Text", e.pos), sym, errors, ctx);
}

function checkAppTheme(app: AppDef, sym: SymbolTable, errors: KumikiError[]): void {
  const theme = app.theme;
  if (theme === undefined || sym.themes.has(theme.name) || sym.slots.has(theme.name)) return;
  errors.push({
    code: "E0118",
    kind: "undef-theme",
    message: `Reference to undefined theme "${theme.name}"`,
    pos: theme.pos,
  });
}
