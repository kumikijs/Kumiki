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
  /** E0103 only: the scope that declared the name and ended before this read. */
  endedScope?: EndedScope;
};

/**
 * A reducer's nested statement bodies (`if`, `for`, `match`), and the expressions that bind a name
 * for their own body: `let … in`, a tile's `for`, an arm of a `match` expression.
 */
export type EndedScope = "if" | "for" | "match" | "let-in" | "for-expr" | "match-expr";

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
  /** Names the ended scopes declared and the enclosing scope does not bind. */
  endedScopes: Map<string, EndedScope>;
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

/** End `inner`, a scope of the kind `kind` opened in `ctx`: its names go out of scope with it. */
export function endScope(kind: EndedScope, inner: Ctx, ctx: Ctx): void {
  for (const name of inner.localBinds) {
    if (!ctx.localBinds.has(name)) ctx.endedScopes.set(name, kind);
  }
}

export function pureScope(binds: string[]): Ctx {
  return {
    kind: "slot-init",
    localBinds: new Set(binds),
    routeBind: "no-payload",
    endedScopes: new Map(),
    localTypes: new Map(),
  };
}

export function wildcardText(e: Expr & { kind: "Wildcard" }): string {
  return e.wild === "any-id" ? "<any-id>" : `<slots.${e.slot}>`;
}
