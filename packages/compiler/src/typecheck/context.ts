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

export type KumikiError = {
  code: string;
  kind: string;
  message: string;
  pos: Pos;
  severity?: "error" | "warning";
  unrendered?: "positional" | "text-prop" | "text-shadowed";
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
  app?: AppDef;
};

/** Names a program reads without declaring them, because the runtime provides each. */
export const RUNTIME_NAMES: ReadonlySet<string> = new Set(["route", "now", "self"]);

export type LocalBinder = "input" | "for";

export type Ctx = {
  kind: "slot-init" | "tile" | "reducer" | "fn" | "app-init" | "test";
  localBinds: Set<string>;
  capsAvailable?: Set<string>; // for reducer context
  localTypes: Map<string, TypeExpr>;
  /** Kept only in a tile's scope, where E0229 reads it to say what a bind target's root is. */
  localBinders?: Map<string, LocalBinder>;
  runReducerScope?: boolean;
  wildcardsReportedElsewhere?: boolean;
  routeBind: "bound" | "unbound" | "no-payload";
  routeReadsSeen?: { name: string; pos: Pos }[];
  fragmentFnCallsSeen?: { name: string; pos: Pos }[];
  undeclaredInputReads?: Pos[];
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
  if (binder) ctx.localBinders?.set(name, binder);
  else ctx.localBinders?.delete(name);
}

/** A copy of `ctx` whose bindings can be extended without touching the parent. */
export function innerScope(ctx: Ctx): Ctx {
  return {
    ...ctx,
    localBinds: new Set(ctx.localBinds),
    localTypes: new Map(ctx.localTypes),
    ...(ctx.localBinders ? { localBinders: new Map(ctx.localBinders) } : {}),
  };
}

export function pureScope(binds: string[]): Ctx {
  return {
    kind: "slot-init",
    localBinds: new Set(binds),
    routeBind: "no-payload",
    localTypes: new Map(),
  };
}

export function wildcardText(e: Expr & { kind: "Wildcard" }): string {
  return e.wild === "any-id" ? "<any-id>" : `<slots.${e.slot}>`;
}
