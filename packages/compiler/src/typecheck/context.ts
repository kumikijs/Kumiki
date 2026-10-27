import type {
  AppDef,
  EffectDef,
  Expr,
  FnDef,
  Pos,
  ReducerDef,
  SlotDef,
  TileDef,
  TypeDef,
  TypeExpr,
} from "../ast.ts";
import { callsBuiltin } from "../builtin-calls.ts";
import { type NestedScopes, nestedScopes } from "./nested-scopes.ts";

export type KumikiError = {
  code: string;
  kind: string;
  message: string;
  pos: Pos;
  severity?: "error" | "warning";
  unrendered?: "positional" | "text-prop" | "text-shadowed";
  /** E0103 only: the scope that declared the name and ended before this read. */
  endedScope?: NestedScope;
  /** E0103 only: the scope that declares the name later and begins after this read. */
  laterScope?: NestedScope;
  /** E0218 only: the member whose append alone makes the target a List; `kumiki fix` reads it. */
  accessor?: "keys" | "to-list";
};

/**
 * A reducer's nested statement bodies (`if`, `for`, `match`), and the expressions that bind a name
 * for their own body: `let … in`, a tile's `for`, an arm of a `match` expression.
 */
export type NestedScope = "if" | "for" | "match" | "let-in" | "for-expr" | "match-expr";

export type SymbolTable = {
  types: Map<string, TypeDef>;
  slots: Map<string, SlotDef>;
  reducers: Map<string, ReducerDef>;
  tiles: Map<string, TileDef>;
  fns: Map<string, FnDef>;
  effects: Map<string, EffectDef>;
  /** Names declared by `timer(d, name=N)` triggers — the `stop-timer` namespace. */
  timerNames: Set<string>;
  prefetchTargets: Set<string>;
  /** Names declared by `motion N = {…}` — the `motion` prop namespace. */
  motions: Set<string>;
  /** Names declared by `theme N = {…}` — the `app.theme` namespace. */
  themes: Set<string>;
  iconDomain: Set<string>;
  elementIds: Set<string>;
  /** The program's own unions, by each tag they declare: `unionsByTag`. */
  unionsByTag: ReadonlyMap<string, readonly TypeExpr[]>;
  app?: AppDef;
};

export type Ctx = {
  kind: "slot-init" | "tile" | "reducer" | "fn" | "app-init" | "test";
  localBinds: Set<string>;
  capsAvailable?: Set<string>; // for reducer context
  localTypes: Map<string, TypeExpr>;
  runReducerScope?: boolean;
  wildcardsReportedElsewhere?: boolean;
  /** `prefetch`: bound only when a link's prefetch fires the reducer, and `{}` on its own trigger. */
  routeBind: "bound" | "prefetch" | "unbound" | "no-payload";
  routeReadsSeen?: { name: string; pos: Pos }[];
  fragmentFnCallsSeen?: { name: string; pos: Pos }[];
  undeclaredInputReads?: Pos[];
  /** Built before the check, so a read before a scope is answered as surely as one after it. */
  nestedScopes: NestedScopes;
  /** The effect whose own expressions are checked, when it declares `in=Unit` and so binds no `$1`. */
  noInputEffect?: string;
  oneValueFragment?: { method: string; hides: boolean };
};

export function bindLocal(ctx: Ctx, name: string, type: TypeExpr | null): void {
  ctx.localBinds.add(name);
  if (type) ctx.localTypes.set(name, type);
  else ctx.localTypes.delete(name);
}

/** A copy of `ctx` whose bindings can be extended without touching the parent. */
export function innerScope(ctx: Ctx): Ctx {
  return { ...ctx, localBinds: new Set(ctx.localBinds), localTypes: new Map(ctx.localTypes) };
}

/** `exprs` are the expressions checked in this scope, whose nested scopes it knows. */
export function pureScope(
  binds: readonly { name: string; type: TypeExpr }[],
  ...exprs: (Expr | undefined)[]
): Ctx {
  const ctx: Ctx = {
    kind: "slot-init",
    localBinds: new Set(),
    routeBind: "no-payload",
    nestedScopes: nestedScopes(...exprs),
    localTypes: new Map(),
  };
  for (const b of binds) bindLocal(ctx, b.name, b.type);
  return ctx;
}

export function wildcardText(e: Expr & { kind: "Wildcard" }): string {
  return e.wild === "any-id" ? "<any-id>" : `<slots.${e.slot}>`;
}

export function isBuiltinCall(callee: string, sym: SymbolTable): boolean {
  return callsBuiltin(callee, (name) => sym.fns.has(name));
}
