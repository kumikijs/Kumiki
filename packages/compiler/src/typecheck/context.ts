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

export type Severity = "error" | "warning";

export type KumikiError = {
  code: string;
  kind: string;
  message: string;
  pos: Pos;
  severity?: Severity;
  unrendered?: "positional" | "text-prop" | "text-shadowed";
  /**
   * E0103 only: the kind of nested scope that declared the name and ended before this read;
   * `kumiki fix` reads it to skip the rename.
   */
  endedScope?: NestedScopeKind;
  /** E0218 only: the member whose append alone makes the target a List; `kumiki fix` reads it. */
  accessor?: "keys" | "to-list";
};

export function severityOf(d: Pick<KumikiError, "severity">): Severity {
  return d.severity ?? "error";
}

/** The nested statement bodies of a reducer, each a scope of its own. */
export type StatementScope = "if" | "for" | "match";

/**
 * A reducer's nested statement bodies, and the expressions that bind a name for their own body:
 * `let … in`, a tile's `for`, an arm of a `match` expression.
 */
export type NestedScopeKind = StatementScope | "let-in" | "for-expr" | "match-expr";

/**
 * The scope a name ended with. `sibling` is set while a later branch or arm of its statement or
 * `match` expression is checked; a `let … in` and a tile's `for` have one body, and so no sibling.
 */
export type EndedScope =
  | { kind: StatementScope | "match-expr"; sibling: boolean }
  | { kind: "let-in" | "for-expr" };

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
  /** The kinds a handler written at the tile's call site can land on (W0213). */
  builtinKindsIn: (tileName: string) => ReadonlySet<string>;
  /** Of those, the kinds at the tile's root, which a call-site handler is merged onto (W0213). */
  rootKindsIn: (tileName: string) => ReadonlySet<string>;
  /** The kinds a subscription on the tile is wired onto (W0212). */
  subscribedKindsIn: (tileName: string) => ReadonlySet<string>;
  /** The kinds the tile renders, a positional argument only where its builtin renders it (E0113). */
  renderedKindsIn: (tileName: string) => ReadonlySet<string>;
  // The program's own tags come first, so a did-you-mean tie goes to one of them.
  constructorTags: ReadonlySet<string>;
  qualifiers: ReadonlySet<string>;
  // A declared type that judged a variant reports it naming that type, so the
  // undef-variant for the same variant is dropped: one mistake, one diagnostic.
  judgedVariants: WeakSet<Expr>;
  undefinedVariants: Map<KumikiError, Expr>;
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
  /**
   * Names the ended scopes declared and the enclosing scope does not bind. Every inner scope shares
   * this one map (`innerScope` spreads it), so a read in a sibling or an enclosing scope sees what
   * an inner one ended.
   */
  endedScopes: Map<string, EndedScope>;
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
export function innerScope<C extends Ctx>(ctx: C): C {
  return {
    ...ctx,
    localBinds: new Set(ctx.localBinds),
    localTypes: new Map(ctx.localTypes),
    localBinders: new Map(ctx.localBinders),
  };
}

/**
 * End `inner`, an expression's scope of the kind `kind` opened in `ctx`: its names end with it. A
 * statement body around it does not take them over as it does a nested statement's, because a read
 * moved into that body would still be after the expression.
 */
export function endScope(kind: "let-in" | "for-expr", inner: Ctx, ctx: Ctx): void {
  for (const name of inner.localBinds) {
    if (!ctx.localBinds.has(name)) ctx.endedScopes.set(name, { kind });
  }
}

/**
 * Check the arms of a `match` expression in order, each by `checkArm` in a scope of its own opened
 * in `ctx`. A name an arm binds ends with the arm, so a read in a later arm is in a sibling of the
 * arm that bound it, and a read after the expression is after every arm.
 */
export function checkArms<A>(
  arms: readonly A[],
  ctx: Ctx,
  checkArm: (arm: A, inner: Ctx) => void,
): void {
  const ended = new Set<string>();
  for (const arm of arms) {
    const inner = innerScope(ctx);
    checkArm(arm, inner);
    for (const name of inner.localBinds) {
      if (ctx.localBinds.has(name)) continue;
      ctx.endedScopes.set(name, { kind: "match-expr", sibling: true });
      ended.add(name);
    }
  }
  for (const name of ended) ctx.endedScopes.set(name, { kind: "match-expr", sibling: false });
}

export function pureScope(binds: readonly { name: string; type: TypeExpr }[]): Ctx {
  const ctx: Ctx = {
    kind: "slot-init",
    localBinds: new Set(),
    routeBind: "no-payload",
    endedScopes: new Map(),
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
