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

export type Severity = "error" | "warning";

export type KumikiError = {
  code: string;
  kind: string;
  message: string;
  pos: Pos;
  severity?: Severity;
  unrendered?: "positional" | "text-prop" | "text-shadowed";
};

export function severityOf(d: Pick<KumikiError, "severity">): Severity {
  return d.severity ?? "error";
}

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

export type Ctx = {
  kind: "slot-init" | "tile" | "reducer" | "fn" | "app-init" | "test";
  localBinds: Set<string>;
  capsAvailable?: Set<string>; // for reducer context
  localTypes: Map<string, TypeExpr>;
  runReducerScope?: boolean;
  wildcardsReportedElsewhere?: boolean;
  routeBind: "bound" | "unbound" | "no-payload";
  routeReadsSeen?: { name: string; pos: Pos }[];
  fragmentFnCallsSeen?: { name: string; pos: Pos }[];
  undeclaredInputReads?: Pos[];
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
