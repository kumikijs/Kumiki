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

export type KumikiError = {
  code: string;
  kind: string;
  message: string;
  pos: Pos;
  severity?: "error" | "warning";
  unrendered?: "positional" | "text-prop" | "text-shadowed";
  /** E0218 only: the member whose append alone makes the target a List; `kumiki fix` reads it. */
  accessor?: "keys" | "to-list";
};

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
  /** The result of each `fn` declared without `->`, read off its body once per check. */
  fnResults: Map<string, TypeExpr | null>;
  /** The `fn`s that can reach themselves through the `fn`s they call: those E0006 reports. */
  fnLoops: ReadonlySet<string>;
  /** The program's own unions, by each tag they declare: `unionsByTag`. */
  unionsByTag: ReadonlyMap<string, readonly TypeExpr[]>;
  app?: AppDef;
};

export type LocalBinder = "input" | "for";

export type Ctx = {
  kind: "slot-init" | "tile" | "reducer" | "fn" | "app-init" | "test";
  localBinds: Set<string>;
  capsAvailable?: Set<string>; // for reducer context
  localTypes: Map<string, TypeExpr>;
  /**
   * What bound each local a tile reads: its input, or a `for`. Any other local has no entry, and
   * outside a tile it stays empty. E0229 reads it to say what a bind target's root is.
   */
  localBinders: Map<string, LocalBinder>;
  runReducerScope?: boolean;
  wildcardsReportedElsewhere?: boolean;
  /** `prefetch`: bound only when a link's prefetch fires the reducer, and `{}` on its own trigger. */
  routeBind: "bound" | "prefetch" | "unbound" | "no-payload";
  routeReadsSeen?: { name: string; pos: Pos }[];
  fragmentFnCallsSeen?: { name: string; pos: Pos }[];
  undeclaredInputReads?: Pos[];
  /** The effect whose own expressions are checked, when it declares `in=Unit` and so binds no `$1`. */
  noInputEffect?: string;
  oneValueFragment?: { method: string; hides: boolean };
};

export function bindLocal(
  ctx: Ctx,
  name: string,
  type: TypeExpr | null,
  binder?: LocalBinder,
): void {
  ctx.localBinds.add(name);
  if (type) ctx.localTypes.set(name, type);
  else ctx.localTypes.delete(name);
  if (binder) ctx.localBinders.set(name, binder);
  else ctx.localBinders.delete(name);
}

/** A copy of `ctx` whose bindings can be extended without touching the parent. */
export function innerScope(ctx: Ctx): Ctx {
  return {
    ...ctx,
    localBinds: new Set(ctx.localBinds),
    localTypes: new Map(ctx.localTypes),
    localBinders: new Map(ctx.localBinders),
  };
}

export function pureScope(binds: readonly { name: string; type: TypeExpr }[]): Ctx {
  const ctx: Ctx = {
    kind: "slot-init",
    localBinds: new Set(),
    routeBind: "no-payload",
    localTypes: new Map(),
    localBinders: new Map(),
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
