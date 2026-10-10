import type { IndexedDbStore, KeyKind } from "@kumikijs/runtime";

export type Pos = { line: number; col: number };

export type Token =
  | { kind: "ident"; value: string; pos: Pos }
  | { kind: "kw"; value: string; pos: Pos }
  | { kind: "num"; value: number; raw: string; pos: Pos }
  | { kind: "str"; value: string; pos: Pos }
  | { kind: "op"; value: string; pos: Pos }
  | { kind: "eof"; pos: Pos };

export type Program = {
  kind: "Program";
  defs: Def[];
};

export type Def =
  | TypeDef
  | SlotDef
  | ReducerDef
  | TileDef
  | FnDef
  | EffectDef
  | AppDef
  | ThemeDef
  | MotionDef
  | TestDef;

// ----- test layer (in-language tests; excluded from the production build) -----

export type TestDef = {
  kind: "TestDef";
  name: string;
  /** `reducer-test` targets a reducer; `tile-test` a tile; `episode-test` replays an episode log; `property-test` has no target. */
  testKind: "reducer-test" | "tile-test" | "property-test" | "episode-test";
  /** Reducer / tile name. Absent for `property-test` / `episode-test`. */
  target?: string;
  targetPos?: Pos;
  /** The `given = { ... }` record literal (interpreted, not codegen'd as-is). */
  given: Expr;
  /** `expect = { slots, effects }` / `{ panic }` (record) for reducer-test; a tile expression for tile-test; `episode-test` uses a record (`{slots-equal, no-panics, ...}`). */
  expect?: Expr | TileExpr;
  /** `property-test` only: the `for-all = { name: Type }` generators. */
  forAll?: { name: string; type: TypeExpr; pos: Pos }[];
  /** `property-test` only: the boolean `invariant` expression checked per case. */
  invariant?: Expr;
  /** `property-test` only: trial count (default 100). */
  count?: number;
  /** `property-test` only: shrink on failure (default true). */
  shrink?: boolean;
  /** `episode-test` only: path to the episode-log file relative to the .kumiki source. */
  load?: string;
  /** `episode-test` only: per-effect mock policy (`from-log` / `ignore` / `ok(v)` / `err(e)`). */
  mocks?: Expr;
  pos: Pos;
};

export type ThemeValue = string | number | { [k: string]: ThemeValue };

export type ThemeDef = {
  kind: "ThemeDef";
  name: string;
  body: { [k: string]: ThemeValue };
  /** Keys seen more than once in the body, at any nesting depth. */
  duplicateKeys?: DuplicateName[];
  pos: Pos;
};

// ----- motion layer (reusable, scoped animations) -----
export type MotionDef = {
  kind: "MotionDef";
  name: string;
  body: { [k: string]: ThemeValue };
  /** Keys seen more than once in the body, at any nesting depth. */
  duplicateKeys?: DuplicateName[];
  pos: Pos;
};

export type TypeDef = {
  kind: "TypeDef";
  name: string;
  params: string[];
  body: TypeExpr;
  pos: Pos;
};

export type SlotDef = {
  kind: "SlotDef";
  name: string;
  type: TypeExpr;
  modifier?: "transient" | "volatile";
  init: Expr;
  pos: Pos;
};

export type ReducerDef = {
  kind: "ReducerDef";
  name: string;
  on: EventPattern;
  do: Statement[];
  pos: Pos;
};

export type TileDef = {
  kind: "TileDef";
  name: string;
  in?: TypeExpr;
  errorBoundary?: string;
  errorBoundaryPos?: Pos;
  subRoutes?: { path: string; tile: string; tilePos?: Pos; pathPos: Pos }[];
  /** Absent ≡ default (true). `false` opts the tile out of automatic restore. */
  scrollRestoration?: boolean;
  /** Clauses written more than once — the later one won silently. */
  duplicateClauses?: DuplicateName[];
  body: TileExpr;
  pos: Pos;
};

export type FnDef = {
  kind: "FnDef";
  name: string;
  params: { name: string; type: TypeExpr; pos: Pos }[];
  ret?: TypeExpr;
  body: Expr;
  pos: Pos;
};

export type EffectDef = {
  kind: "EffectDef";
  name: string;
  cap: string;
  inType: TypeExpr;
  outType: TypeExpr;
  policy?: PolicyExpr;
  retry?: RetryExpr;
  mapRequest?: Expr; // record literal usually
  /** Clauses written more than once — the later one won silently. */
  duplicateClauses?: DuplicateName[];
  pos: Pos;
};

export type AppHttpConfig = {
  baseUrl?: Expr;
  headers?: Expr;
  on401?: NamedRef;
  on403?: NamedRef;
  on5xx?: NamedRef;
  timeout?: Expr;
  credentials?: Expr;
  pos: Pos;
};

export type AppIndexedDbStore = IndexedDbStore;

export type AppIndexedDbConfig = {
  name: string;
  version: number;
  stores: AppIndexedDbStore[];
  pos: Pos;
};

export type AppMetaConfig = {
  title?: string;
  description?: string;
  ogImage?: string;
  favicon?: string;
  pos: Pos;
};

export type AppAnalyticsConfig = {
  provider: "console" | "noop";
  appId?: string;
  pos: Pos;
};

export type NamedRef = { readonly name: string; readonly pos: Pos };

export type DuplicateName = NamedRef;

export type AppDef = {
  kind: "AppDef";
  name: string;
  caps: string[];
  routes: { path: string; tile: string; tilePos?: Pos; pathPos: Pos }[];
  init: Expr[];
  theme?: NamedRef;
  http?: AppHttpConfig;
  indexedDb?: AppIndexedDbConfig;
  meta?: AppMetaConfig;
  analytics?: AppAnalyticsConfig;
  /** Clauses written more than once — the later one won silently. */
  duplicateClauses?: DuplicateName[];
  configSources?: Expr[];
  pos: Pos;
};

// ----- Types -----

export type TypeExpr =
  | {
      kind: "TypePrim";
      name: "Int" | "Text" | "Bool" | "Unit" | "Float" | "Time" | "Bytes" | "File" | "EffectId";
      pos: Pos;
    }
  | { kind: "TypeRef"; name: string; pos: Pos }
  | { kind: "TypeApp"; name: string; args: TypeExpr[]; pos: Pos }
  | { kind: "TypeRecord"; fields: { name: string; type: TypeExpr; pos: Pos }[]; pos: Pos }
  | { kind: "TypeUnion"; variants: { name: string; payloads: TypeExpr[]; pos: Pos }[]; pos: Pos }
  | { kind: "TypeNominal"; inner: TypeExpr; refinement?: Refinement; pos: Pos }
  | { kind: "TypeRefinement"; inner: TypeExpr; refinement: Refinement; pos: Pos };

const TILE_EXPR_KINDS: ReadonlySet<string> = new Set([
  "TileCall",
  "TileFor",
  "TileWhen",
  "TileIf",
  "TileMatch",
]);

export function isTileExpr(v: Expr | TileExpr): v is TileExpr {
  return TILE_EXPR_KINDS.has((v as TileExpr).kind);
}

export type WrittenProp = { value: Expr; namePos: Pos };

// A named argument and a `{…}` entry of the same name are one prop, and every reader asks here so
// none reads one spelling only. The block wins when a call writes both; a tile-test's expected tree
// passes no block because a snapshot does not compare it. A tile written as an argument is a child.
export function writtenProp(
  t: TileExpr & { kind: "TileCall" },
  name: string,
  block: readonly TileProp[] = t.props,
): WrittenProp | undefined {
  const prop = block.find((p) => p.name === name);
  if (prop) return { value: prop.value, namePos: prop.pos };
  const arg = t.args.find((a) => a.name === name);
  if (arg?.name === undefined || isTileExpr(arg.value)) return undefined;
  return { value: arg.value, namePos: arg.namePos };
}

export function assertNever(node: never): void {
  void node;
}

export type Refinement = {
  kind: "Refinement";
  pred: string;
  args: (number | string)[];
  pos: Pos;
};

// ----- Events -----

export type EventPattern =
  | {
      kind: "UiEvent";
      ev: UiEventKind;
      selector: { tile: string; id?: string; tilePos?: Pos };
      pos: Pos;
    }
  | {
      kind: "EffectEvent";
      effect: string;
      outcome: "ok" | "err";
      binds: NamedRef[];
      effectPos: Pos;
      pos: Pos;
    }
  | { kind: "TimerEvent"; intervalMs: number; name?: string; pos: Pos }
  | {
      kind: "LifecycleEvent";
      name: string;
      tileTarget?: { readonly event: "tile.mount" | "tile.unmount" } & NamedRef;
      pos: Pos;
    };

export type UiEventKind =
  | "click"
  | "submit"
  | "change"
  | "input"
  | "focus"
  | "blur"
  | "key"
  | "hover";

// ----- Statements (reducer body) -----

export type Statement =
  | { kind: "SlotAssign"; lvalue: Lvalue; rhs: Expr; pos: Pos }
  | { kind: "LetStmt"; name: string; rhs: Expr; pos: Pos }
  | { kind: "Emit"; effect: string; args: Expr[]; effectPos?: Pos; pos: Pos }
  | { kind: "StopTimer"; name: string; pos: Pos }
  | { kind: "ForStmt"; bind: string; iter: Expr; body: Statement[]; pos: Pos }
  | { kind: "IfStmt"; cond: Expr; consequent: Statement[]; alternate: Statement[]; pos: Pos }
  | {
      kind: "MatchStmt";
      scrutinee: Expr;
      arms: { pattern: Pattern; body: Statement[] }[];
      pos: Pos;
    }
  | { kind: "PanicStmt"; message: Expr; pos: Pos }
  | { kind: "NoopStmt"; pos: Pos };

export type Lvalue =
  | { kind: "LSlot"; name: string; pos: Pos }
  | { kind: "LIndex"; base: Lvalue; index: Expr; pos: Pos }
  | {
      kind: "LField";
      base: Lvalue;
      field: string;
      pos: Pos;
      accessKind?: "field" | "shortcut";
    };

// ----- Expressions -----

export type { KeyKind };

export type FragmentShape = "pair" | "key-value" | "value" | "undecided";

export type Expr =
  | { kind: "Num"; value: number; raw?: string; pos: Pos }
  | { kind: "Str"; value: string; pos: Pos }
  | { kind: "Bool"; value: boolean; pos: Pos }
  | { kind: "Unit"; pos: Pos }
  | { kind: "TupleLit"; items: [Expr, Expr, ...Expr[]]; pos: Pos }
  | { kind: "Ref"; name: string; pos: Pos }
  | { kind: "BinOp"; op: BinOp; lhs: Expr; rhs: Expr; pos: Pos }
  | { kind: "UnaryOp"; op: "-" | "!"; rhs: Expr; pos: Pos }
  | {
      kind: "FieldAccess";
      base: Expr;
      field: string;
      pos: Pos;
      accessKind?: "field" | "shortcut";
      /** See {@link KeyKind}. Filled in by the type checker. */
      keyKind?: KeyKind;
    }
  | { kind: "Index"; base: Expr; index: Expr; pos: Pos }
  | { kind: "Call"; callee: string; args: Expr[]; pos: Pos } // module-level fns and ctors (TodoId.fresh, Duration.ms, ...)
  | {
      kind: "MethodCall";
      receiver: Expr;
      method: string;
      args: Expr[];
      pos: Pos;
      /** See {@link KeyKind}. Filled in by the type checker. */
      keyKind?: KeyKind;
      fragmentShape?: FragmentShape;
    }
  | { kind: "RecordLit"; fields: { name: string; value: Expr; pos: Pos }[]; pos: Pos }
  | {
      kind: "ListLit";
      items: Expr[];
      pos: Pos;
      asSet?: true;
    }
  | { kind: "MapLit"; entries: { key: Expr; value: Expr }[]; pos: Pos }
  | { kind: "Wildcard"; wild: "any-id"; pos: Pos }
  | { kind: "Wildcard"; wild: "slot"; slot: string; pos: Pos }
  | { kind: "MatchExpr"; scrutinee: Expr; arms: MatchArm[]; pos: Pos }
  | { kind: "IfExpr"; cond: Expr; consequent: Expr; alternate: Expr; pos: Pos }
  | { kind: "LetIn"; name: string; value: Expr; body: Expr; pos: Pos }
  | { kind: "EmitExpr"; effect: string; args: Expr[]; effectPos?: Pos; pos: Pos }
  | { kind: "Variant"; name: string; payload: Expr[]; pos: Pos } // e.g., All, Some(x), Loaded(t)
  | { kind: "TokenRef"; group: string; path: string[]; pos: Pos };

export type MatchArm = {
  pattern: Pattern;
  body: Expr;
};

export type Pattern =
  | { kind: "PVariant"; name: string; binds: string[]; pos: Pos } // All, Some(x), Loaded(x), _ has special form
  | { kind: "PWildcard"; pos: Pos }
  | { kind: "PBind"; name: string; pos: Pos } // single identifier
  | { kind: "PTuple"; items: Pattern[]; pos: Pos }; // (p1, p2, ...) — destructures Tuple values

export type BinOp = "+" | "-" | "*" | "/" | "%" | "==" | "!=" | "<" | ">" | "<=" | ">=" | "&" | "|"; // boolean and/or

// ----- Policies -----

export type PolicyExpr =
  | { kind: "PolLatest" }
  | { kind: "PolLatestKey"; key: Expr }
  | { kind: "PolQueue" }
  | { kind: "PolDebounce"; ms: number }
  | { kind: "PolThrottle"; ms: number }
  | { kind: "PolOnce" };

export type RetryExpr =
  | { kind: "RetryNone" }
  | { kind: "RetryLinear"; n: number; ms: number }
  | { kind: "RetryExp"; n: number; ms: number; factor: number };

// ----- Tile expressions -----

export type TileExpr =
  | { kind: "TileCall"; name: string; args: TileArg[]; props: TileProp[]; pos: Pos }
  | { kind: "TileFor"; bind: string; iter: Expr; body: TileExpr; pos: Pos }
  | { kind: "TileWhen"; cond: Expr; body: TileExpr; pos: Pos }
  | { kind: "TileIf"; cond: Expr; consequent: TileExpr; alternate: TileExpr; pos: Pos }
  | { kind: "TileMatch"; scrutinee: Expr; arms: TileMatchArm[]; pos: Pos };

export type TileMatchArm = {
  pattern: Pattern;
  body: TileExpr;
};

export type TileArg =
  | { kind: "TileArg"; name: string; namePos: Pos; value: Expr | TileExpr }
  | { kind: "TileArg"; name?: never; namePos?: never; value: Expr | TileExpr };

export type TileProp = {
  kind: "TileProp";
  name: string;
  pos: Pos;
  value: Expr;
};
