// AST types for Kumiki.

export type Pos = { line: number; col: number };

export type Token =
  | { kind: "ident"; value: string; pos: Pos }
  | { kind: "kw"; value: string; pos: Pos }
  /**
   * `raw` is the literal as written. `value` is already the rounded double, so
   * without it a precision diagnostic can only report the rounded number twice
   * and read as self-contradicting.
   */
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
  forAll?: { name: string; type: TypeExpr }[];
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

/**
 * A name the parser saw a second time in a construct that keeps only one.
 *
 * `app`, `effect` and the theme-record grammar all assemble their fields into
 * a record, so the later of two same-named clauses overwrites the earlier and
 * the duplicate leaves no trace in the tree. Recording it here is what lets
 * the checker report `E0008` — the alternative, throwing from the parser,
 * would stop at the first one and take the whole file's editing verbs with it.
 */
export type DuplicateName = { name: string; pos: Pos };

export type ThemeDef = {
  kind: "ThemeDef";
  name: string;
  body: { [k: string]: ThemeValue };
  /** Keys seen more than once in the body, at any nesting depth. */
  duplicateKeys?: DuplicateName[];
  pos: Pos;
};

// ----- motion layer (reusable, scoped animations) -----
// A purely-presentational definition modeled on `theme`: the body is a record
// literal (so it cannot reference slots/effects — purity is structural).
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
  subRoutes?: { path: string; tile: string; tilePos?: Pos }[];
  /** §3.9 scroll-restoration. Absent ≡ default (true). `false` opts the tile out of automatic restore. */
  scrollRestoration?: boolean;
  body: TileExpr;
  pos: Pos;
};

export type FnDef = {
  kind: "FnDef";
  name: string;
  params: { name: string; type: TypeExpr }[];
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
  // `headers` stays as an Expr because it may reference live slot state
  // (e.g. session tokens) and must be re-evaluated on every request, not frozen
  // at mount.
  baseUrl?: Expr;
  headers?: Expr;
  on401?: string;
  on403?: string;
  on5xx?: string;
  /** Positions of the three reducer names above, keyed by field. */
  reducerRefPos?: { on401?: Pos; on403?: Pos; on5xx?: Pos };
  timeout?: Expr;
  credentials?: Expr;
  pos: Pos;
};

export type AppIndexedDbStore = {
  name: string;
  key: string;
  indexes?: string[];
};

export type AppIndexedDbConfig = {
  name: string;
  version: number;
  stores: AppIndexedDbStore[];
  pos: Pos;
};

// app.meta — document-level metadata reflected into <head> at mount.
// All fields are static string literals (no slot refs): the head is set once
// at startup and the AI should be able to read these values without running
// the app. Keys are the spec's closed set (style.md §4): title, description,
// og-image, favicon. Unknown keys are rejected by the parser.
export type AppMetaConfig = {
  title?: string;
  description?: string;
  ogImage?: string;
  favicon?: string;
  pos: Pos;
};

// app.analytics — opts the app into a default `analytics.send` provider so an
// app can emit measurement events without a host registering one (runtime.md
// §10.4.6). `provider: "console"` logs each event; `"noop"` silently absorbs
// them — useful in tests / preview environments where you want the capability
// declared but no actual sink. A host-supplied provider for `analytics.send`
// still takes precedence over this default (the inbound ecosystem seam).
export type AppAnalyticsConfig = {
  provider: "console" | "noop";
  appId?: string;
  pos: Pos;
};

export type AppDef = {
  kind: "AppDef";
  name: string;
  caps: string[];
  routes: { path: string; tile: string; tilePos?: Pos; pathPos?: Pos }[];
  init: Expr[];
  theme?: string;
  themePos?: Pos;
  http?: AppHttpConfig;
  indexedDb?: AppIndexedDbConfig;
  meta?: AppMetaConfig;
  analytics?: AppAnalyticsConfig;
  /** Clauses written more than once — the later one won silently. */
  duplicateClauses?: DuplicateName[];
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

/**
 * Node kinds of `TileExpr`. A tile argument's `value` is typed `Expr | TileExpr`
 * and every consumer has to tell them apart, so the set lives with the types it
 * describes rather than being re-listed at each site.
 */
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
      binds: string[];
      /** Position of the effect name itself, which `pos` (the whole pattern) does not give. */
      effectPos?: Pos;
      pos: Pos;
    }
  | { kind: "TimerEvent"; intervalMs: number; name?: string; pos: Pos }
  | {
      kind: "LifecycleEvent";
      name: string;
      /**
       * For `tile.mount(X)` / `tile.unmount(X)`, where `X` sits. The tile name
       * is folded into `name` as `tile.mount("X")`, so without this there is no
       * way to rewrite it except by matching text inside that string.
       */
      tileNamePos?: Pos;
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
  | { kind: "NoopStmt"; pos: Pos };

export type Lvalue =
  | { kind: "LSlot"; name: string; pos: Pos }
  | { kind: "LIndex"; base: Lvalue; index: Expr; pos: Pos }
  | { kind: "LField"; base: Lvalue; field: string; pos: Pos };

// ----- Expressions -----

export type Expr =
  | { kind: "Num"; value: number; raw?: string; pos: Pos }
  | { kind: "Str"; value: string; pos: Pos }
  | { kind: "Bool"; value: boolean; pos: Pos }
  | { kind: "Unit"; pos: Pos }
  | { kind: "Ref"; name: string; pos: Pos }
  | { kind: "BinOp"; op: BinOp; lhs: Expr; rhs: Expr; pos: Pos }
  | { kind: "UnaryOp"; op: "-" | "!"; rhs: Expr; pos: Pos }
  | {
      kind: "FieldAccess";
      base: Expr;
      field: string;
      pos: Pos;
      /**
       * Dispatch decision filled in by the type checker (ADR-002): `"field"`
       * means the receiver is a record with this field, so codegen lowers a
       * field read instead of a method shortcut (kills the #23 shadow). Absent /
       * `"shortcut"` keeps the name-based shortcut dispatch (back-compat — also
       * the case when codegen runs without `check()`).
       */
      accessKind?: "field" | "shortcut";
    }
  | { kind: "Index"; base: Expr; index: Expr; pos: Pos }
  | { kind: "Call"; callee: string; args: Expr[]; pos: Pos } // module-level fns and ctors (TodoId.fresh, math.abs, ...)
  | { kind: "MethodCall"; receiver: Expr; method: string; args: Expr[]; pos: Pos }
  | { kind: "RecordLit"; fields: { name: string; value: Expr; pos?: Pos }[]; pos: Pos }
  | { kind: "ListLit"; items: Expr[]; pos: Pos }
  | { kind: "MapLit"; entries: { key: Expr; value: Expr }[]; pos: Pos } // also Set if values are unit
  // Test `expect` wildcards (spec/testing.md §8.2.2). Legal only inside a
  // reducer-test `expect`; rejected elsewhere (E0109). `<any-id>` matches any
  // generated id; `<slots.X>` matches slot X's post-execution value.
  | { kind: "Wildcard"; wild: "any-id"; pos: Pos }
  | { kind: "Wildcard"; wild: "slot"; slot: string; pos: Pos }
  | { kind: "MatchExpr"; scrutinee: Expr; arms: MatchArm[]; pos: Pos }
  | { kind: "IfExpr"; cond: Expr; consequent: Expr; alternate: Expr; pos: Pos }
  | { kind: "LetIn"; name: string; value: Expr; body: Expr; pos: Pos }
  // `emit X(args)` used as an expression — yields the dispatched effect's
  // `EffectId` (spec §2.1.1.1, http.md §6.4). Statement-form `emit` keeps the
  // separate `Statement.Emit` so existing reducers without a capture stay
  // unchanged.
  | { kind: "EmitExpr"; effect: string; args: Expr[]; effectPos?: Pos; pos: Pos }
  | { kind: "Variant"; name: string; payload: Expr[]; pos: Pos } // e.g., All, Some(x), Loaded(t)
  // Theme-token reference (spec/style.md §4.3): `@colors.surface`,
  // `@spacing.md`, `@typography.size.lg`. `group` is the top-level theme
  // namespace; `path` is the dotted path beneath it (always ≥ 1 segment).
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

export type TileArg = {
  kind: "TileArg";
  name?: string;
  value: Expr | TileExpr;
};

export type TileProp = {
  kind: "TileProp";
  name: string;
  value: Expr;
};
