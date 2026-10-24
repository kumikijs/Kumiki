import type { AppDef, Expr, FnDef, Pos } from "../ast.ts";
import { type FnScopeBind, fnScope } from "../fn-scope.ts";
import type { Ctx, SymbolTable } from "./context.ts";
import { checkExpr } from "./expr.ts";
import { walkExpr } from "./expr-walk.ts";
import { nestedScopes } from "./nested-scopes.ts";

function routeChainText(name: string, chain?: readonly string[]): string {
  return chain === undefined ? "" : ` through "${chain[0]}" (${[...chain, name].join(" → ")})`;
}

/** What every E0120 says, whether the read is written in the argument or sits behind a `fn` call. */
export function routeInAppInitMessage(name: string, chain?: readonly string[]): string {
  return (
    `"${name}" is not available in an app.init argument${routeChainText(name, chain)}: these ` +
    `arguments are evaluated once, while the app object is being built, and the runtime ` +
    `installs the route during the mount that follows. Take the route from a route.enter ` +
    `reducer, which runs with the route the app landed on`
  );
}

export function routeInSlotInitMessage(
  slot: string,
  name: string,
  chain?: readonly string[],
): string {
  return (
    `Slot "${slot}" reads "${name}"${routeChainText(name, chain)} in its initial value; ` +
    `derived slots are prohibited, and this one cannot be computed at all: initial values ` +
    `are evaluated while the module loads, and the runtime installs the route during the ` +
    `mount that follows. Take the route from a route.enter reducer, which runs with the ` +
    `route the app landed on`
  );
}

export function routeReadsIn(
  e: Expr,
  sym: SymbolTable,
  params: readonly FnScopeBind[] = [],
): { name: string; pos: Pos }[] {
  return preMountProbe(e, sym, params).routeReads;
}

function preMountProbe(
  e: Expr,
  sym: SymbolTable,
  params: readonly FnScopeBind[],
): { routeReads: { name: string; pos: Pos }[]; fragmentFnCalls: { name: string; pos: Pos }[] } {
  const routeReads: { name: string; pos: Pos }[] = [];
  const fragmentFnCalls: { name: string; pos: Pos }[] = [];
  const ctx: Ctx = {
    kind: "app-init",
    localBinds: new Set(params.map((p) => p.name)),
    localTypes: new Map(params.map((p) => [p.name, p.type])),
    routeBind: "no-payload",
    nestedScopes: nestedScopes(e),
    routeReadsSeen: routeReads,
    fragmentFnCallsSeen: fragmentFnCalls,
  };
  checkExpr(e, sym, [], ctx);
  return { routeReads, fragmentFnCalls };
}

function fnCallsIn(
  e: Expr,
  sym: SymbolTable,
  params: readonly FnScopeBind[] = [],
): { name: string; pos: Pos }[] {
  const out: { name: string; pos: Pos }[] = [];
  walkExpr(e, (n) => {
    if (n.kind === "Call" && sym.fns.has(n.callee)) out.push({ name: n.callee, pos: n.pos });
  });
  out.push(...preMountProbe(e, sym, params).fragmentFnCalls);
  return out.sort((a, b) => a.pos.line - b.pos.line || a.pos.col - b.pos.col);
}

export type RouteChainResolver = (start: string) => { chain: string[]; name: string } | null;

export function routeReachedThroughCalls(
  e: Expr,
  sym: SymbolTable,
  routeChain: RouteChainResolver,
): { pos: Pos; chain: string[]; name: string }[] {
  const out: { pos: Pos; chain: string[]; name: string }[] = [];
  for (const call of fnCallsIn(e, sym)) {
    const reached = routeChain(call.name);
    if (reached !== null) out.push({ pos: call.pos, ...reached });
  }
  return out;
}

export function routeChainResolver(sym: SymbolTable): RouteChainResolver {
  const direct = new Map<string, string | null>();
  const readsRoute = (name: string): string | null => {
    const cached = direct.get(name);
    if (cached !== undefined) return cached;
    const fn = sym.fns.get(name);
    const answer = fn ? (routeReadsIn(fn.body, sym, fnScope(fn))[0]?.name ?? null) : null;
    direct.set(name, answer);
    return answer;
  };
  const calls = new Map<string, readonly { name: string }[]>();
  const callsOf = (fn: FnDef): readonly { name: string }[] => {
    const cached = calls.get(fn.name);
    if (cached !== undefined) return cached;
    const answer = fnCallsIn(fn.body, sym, fnScope(fn));
    calls.set(fn.name, answer);
    return answer;
  };

  return (start: string) => {
    const parent = new Map<string, string | null>([[start, null]]);
    const queue: string[] = [start];
    for (let i = 0; i < queue.length; i++) {
      const name = queue[i];
      if (name === undefined) continue;
      const read = readsRoute(name);
      if (read !== null) {
        const chain: string[] = [];
        for (let at: string | null | undefined = name; at != null; at = parent.get(at)) {
          chain.unshift(at);
        }
        return { chain, name: read };
      }
      const fn = sym.fns.get(name);
      if (!fn) continue;
      for (const callee of callsOf(fn)) {
        if (parent.has(callee.name)) continue;
        parent.set(callee.name, name);
        queue.push(callee.name);
      }
    }
    return null;
  };
}

export function servesNotFound(routes: AppDef["routes"]): boolean {
  return routes.some((r) => r.path === "/404" && !r.tile.startsWith(">>"));
}
