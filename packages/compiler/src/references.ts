// Which top-level definitions does a definition reference, and exactly where?
//
// This is what the AI-editing verbs (`refs`, `view --with-deps`, `rename`,
// `remove --cascade`) need and could not get before: they matched names as text
// over the source, so a record field, a word in a comment, a string literal and
// a loop variable all counted as references to a definition that happened to
// share their spelling — and `rename` rewrote every one of them.
//
// The question here is deliberately narrower than the typechecker's. `typecheck`
// asks "is this name legal in this position"; this asks "which definition does
// this name denote, and at which source position". Sharing an implementation
// would mean answering both at once, so the two walks stay separate — but the
// resolution ORDER below (locals shadow definitions; a bare name in a handler
// prop is a reducer) is the same order `typecheck` applies, and a divergence
// would show up as `refs` disagreeing with a compile error.

import type {
  AppDef,
  Def,
  EffectDef,
  Expr,
  FnDef,
  Pos,
  Program,
  ReducerDef,
  SlotDef,
  Statement,
  TestDef,
  TileArg,
  TileDef,
  TileExpr,
  TypeDef,
  TypeExpr,
} from "./ast.ts";
import { HANDLER_NAMES } from "./ui-lifts.ts";

/** The layers a name can denote. `app` and `test` are never referenced by name. */
export type RefLayer = "type" | "slot" | "effect" | "reducer" | "tile" | "fn" | "theme" | "motion";

export type Reference = {
  layer: RefLayer;
  name: string;
  /**
   * Position of the identifier token itself, so a rewrite can be exact.
   *
   * Absent when the reference has no identifier of its own to point at — a
   * test's `{slots: {count: 0}}` key, for instance, where the slot name is the
   * key of a record. The edge is real (`refs` and `remove --cascade` must see
   * it), but `rename` has nothing to rewrite and skips it rather than guessing.
   */
  pos?: Pos;
};

/** Definition names by layer, for resolving a bare name to a definition. */
export type DefIndex = Record<RefLayer, Set<string>>;

// Exhaustive on purpose. With `Partial<…>`, a new `Def` kind would compile and
// then vanish from the reference graph: `refs` would report it as unreferenced,
// `remove` would delete it without warning, and `rename` would miss every use.
const LAYER_OF_DEF: Record<Def["kind"], RefLayer | null> = {
  TypeDef: "type",
  SlotDef: "slot",
  EffectDef: "effect",
  ReducerDef: "reducer",
  TileDef: "tile",
  FnDef: "fn",
  ThemeDef: "theme",
  MotionDef: "motion",
  // Never referenced by name from another definition.
  AppDef: null,
  TestDef: null,
};

/** The layer a definition occupies, or null for `app` / `test` (never referenced). */
export function layerOfDef(def: Def): RefLayer | null {
  return LAYER_OF_DEF[def.kind];
}

export function buildDefIndex(program: Program): DefIndex {
  const index: DefIndex = {
    type: new Set(),
    slot: new Set(),
    effect: new Set(),
    reducer: new Set(),
    tile: new Set(),
    fn: new Set(),
    theme: new Set(),
    motion: new Set(),
  };
  for (const d of program.defs) {
    const layer = layerOfDef(d);
    if (layer && "name" in d) index[layer].add(d.name);
  }
  return index;
}

/**
 * Every reference `def` makes to a top-level definition, in no particular
 * order and with duplicates preserved — `rename` needs one entry per
 * occurrence, and `refs` deduplicates for itself.
 *
 * Names that resolve to nothing (builtin tiles, stdlib functions, capability
 * names, variant constructors, local binds) are simply absent. That is the
 * point: over-inclusion is what made `remove --cascade` delete most of a file.
 */
export function referencesIn(def: Def, index: DefIndex): Reference[] {
  const out: Reference[] = [];
  const w = new Walker(index, out);
  switch (def.kind) {
    case "TypeDef":
      w.typeExpr((def as TypeDef).body);
      break;
    case "SlotDef": {
      const s = def as SlotDef;
      w.typeExpr(s.type);
      if (s.init) w.expr(s.init, new Set());
      break;
    }
    case "EffectDef": {
      const e = def as EffectDef;
      w.typeExpr(e.inType);
      w.typeExpr(e.outType);
      if (e.policy?.kind === "PolLatestKey") w.expr(e.policy.key, new Set(["$1"]));
      if (e.mapRequest) w.expr(e.mapRequest, new Set(["$1"]));
      break;
    }
    case "ReducerDef":
      w.reducer(def as ReducerDef);
      break;
    case "TileDef":
      w.tile(def as TileDef);
      break;
    case "FnDef": {
      const f = def as FnDef;
      const locals = new Set<string>();
      for (const p of f.params) {
        w.typeExpr(p.type);
        locals.add(p.name);
      }
      if (f.ret) w.typeExpr(f.ret);
      w.expr(f.body, locals);
      break;
    }
    case "AppDef":
      w.app(def as AppDef);
      break;
    case "TestDef":
      w.test(def as TestDef);
      break;
    default:
      // `theme` and `motion` bodies are literal values — no names to resolve.
      break;
  }
  return out;
}

class Walker {
  constructor(
    private readonly index: DefIndex,
    private readonly out: Reference[],
  ) {}

  private add(layer: RefLayer, name: string, pos: Pos | undefined): void {
    if (!pos) return;
    if (!this.index[layer].has(name)) return;
    this.out.push({ layer, name, pos });
  }

  typeExpr(t: TypeExpr | undefined): void {
    if (!t) return;
    switch (t.kind) {
      case "TypeRef":
        this.add("type", t.name, t.pos);
        return;
      case "TypeApp":
        // `Map(K, V)` and friends are builtin generics; a user type used as a
        // constructor lands here too, and `add` drops the ones that are not
        // definitions.
        this.add("type", t.name, t.pos);
        for (const a of t.args) this.typeExpr(a);
        return;
      case "TypeRecord":
        // Field NAMES are not references — this is the case that made `rename`
        // rewrite a record schema. Only their types are walked.
        for (const f of t.fields) this.typeExpr(f.type);
        return;
      case "TypeUnion":
        for (const v of t.variants) for (const p of v.payloads) this.typeExpr(p);
        return;
      case "TypeNominal":
      case "TypeRefinement":
        this.typeExpr(t.inner);
        return;
      default:
        return;
    }
  }

  /**
   * A bare identifier. Locals win over definitions — a `for x in …` binding
   * that shares a slot's name is not a reference to that slot. Then slot, then
   * fn: a name cannot occupy both without the typechecker rejecting it.
   */
  private bareName(name: string, pos: Pos, locals: ReadonlySet<string>): void {
    if (locals.has(name)) return;
    if (name === "route" || name === "now" || name.startsWith("$")) return;
    if (this.index.slot.has(name)) this.add("slot", name, pos);
    else if (this.index.fn.has(name)) this.add("fn", name, pos);
    else if (this.index.theme.has(name)) this.add("theme", name, pos);
  }

  expr(e: Expr | undefined, locals: ReadonlySet<string>): void {
    if (!e) return;
    switch (e.kind) {
      case "Ref":
        this.bareName(e.name, e.pos, locals);
        return;
      case "BinOp":
        this.expr(e.lhs, locals);
        this.expr(e.rhs, locals);
        return;
      case "UnaryOp":
        this.expr(e.rhs, locals);
        return;
      case "FieldAccess":
        this.expr(e.base, locals);
        return;
      case "Index":
        this.expr(e.base, locals);
        this.expr(e.index, locals);
        return;
      case "Call":
        // `run-reducer(name)` (§8.3) takes a reducer NAME, not a value.
        if (e.callee === "run-reducer") {
          this.runReducerArg(e.args[0]);
          return;
        }
        // `TodoId.fresh()` and `math.abs(x)` are qualified — only an unqualified
        // callee can name a `fn` definition.
        if (!e.callee.includes(".")) this.add("fn", e.callee, e.pos);
        for (const a of e.args) this.expr(a, locals);
        return;
      case "MethodCall":
        this.expr(e.receiver, locals);
        if (e.method === "run-reducer") {
          this.runReducerArg(e.args[0]);
          return;
        }
        for (const a of e.args) this.expr(a, locals);
        return;
      case "RecordLit":
        // Field names are keys, not references (see TypeRecord above).
        for (const f of e.fields) this.expr(f.value, locals);
        return;
      case "ListLit":
        for (const i of e.items) this.expr(i, locals);
        return;
      case "MapLit":
        for (const en of e.entries) {
          this.expr(en.key, locals);
          this.expr(en.value, locals);
        }
        return;
      case "MatchExpr": {
        this.expr(e.scrutinee, locals);
        for (const arm of e.arms) {
          const inner = withPatternBinds(locals, arm.pattern);
          this.expr(arm.body, inner);
        }
        return;
      }
      case "IfExpr":
        this.expr(e.cond, locals);
        this.expr(e.consequent, locals);
        this.expr(e.alternate, locals);
        return;
      case "LetIn": {
        this.expr(e.value, locals);
        const inner = new Set(locals);
        inner.add(e.name);
        this.expr(e.body, inner);
        return;
      }
      case "EmitExpr":
        this.add("effect", e.effect, e.effectPos);
        for (const a of e.args) this.expr(a, locals);
        return;
      case "Variant":
        for (const p of e.payload) this.expr(p, locals);
        return;
      default:
        return;
    }
  }

  /** A capitalised reducer name parses as `Variant`, a lowercase one as `Ref`. */
  private runReducerArg(arg: Expr | undefined): void {
    if (arg?.kind === "Ref") this.add("reducer", arg.name, arg.pos);
    else if (arg?.kind === "Variant") this.add("reducer", arg.name, arg.pos);
  }

  statement(s: Statement, locals: Set<string>): void {
    switch (s.kind) {
      case "SlotAssign": {
        let lv = s.lvalue;
        while (lv.kind !== "LSlot") {
          if (lv.kind === "LIndex") this.expr(lv.index, locals);
          lv = lv.base;
        }
        this.add("slot", lv.name, lv.pos);
        this.expr(s.rhs, locals);
        return;
      }
      case "LetStmt":
        this.expr(s.rhs, locals);
        locals.add(s.name);
        return;
      case "Emit":
        this.add("effect", s.effect, s.effectPos);
        for (const a of s.args) this.confirmAwareExpr(s.effect, a, locals);
        return;
      case "ForStmt": {
        this.expr(s.iter, locals);
        const inner = new Set(locals);
        inner.add(s.bind);
        for (const b of s.body) this.statement(b, inner);
        return;
      }
      case "IfStmt":
        this.expr(s.cond, locals);
        for (const b of s.consequent) this.statement(b, new Set(locals));
        for (const b of s.alternate) this.statement(b, new Set(locals));
        return;
      case "MatchStmt": {
        this.expr(s.scrutinee, locals);
        for (const arm of s.arms) {
          const inner = new Set(withPatternBinds(locals, arm.pattern));
          for (const b of arm.body) this.statement(b, inner);
        }
        return;
      }
      default:
        return;
    }
  }

  /**
   * `emit confirm({onYes: r, onNo: r})` (lifecycle §7.6): those two fields name
   * reducers, not values. Every other field, and every other effect, takes the
   * ordinary path.
   */
  private confirmAwareExpr(effect: string, arg: Expr, locals: ReadonlySet<string>): void {
    if (effect !== "confirm" || arg.kind !== "RecordLit") {
      this.expr(arg, locals);
      return;
    }
    for (const f of arg.fields) {
      if ((f.name === "onYes" || f.name === "onNo") && f.value.kind === "Ref") {
        this.add("reducer", f.value.name, f.value.pos);
        continue;
      }
      this.expr(f.value, locals);
    }
  }

  reducer(r: ReducerDef): void {
    const locals = new Set<string>(["$el", "$event", "$route", "$now"]);
    if (r.on.kind === "UiEvent") {
      this.add("tile", r.on.selector.tile, r.on.selector.tilePos);
    } else if (r.on.kind === "EffectEvent") {
      this.add("effect", r.on.effect, r.on.effectPos);
      for (const b of r.on.binds) if (b !== "_") locals.add(b);
    } else if (r.on.kind === "LifecycleEvent") {
      // `tile.mount(X)` folds the tile name into the event name, so the parser
      // records where `X` sat. Reporting the pattern's own position instead
      // would break the contract on `Reference.pos` and make `rename` abort.
      const m = r.on.name.match(/^tile\.(?:un)?mount\("([^"]+)"\)$/);
      if (m?.[1]) this.add("tile", m[1], r.on.tileNamePos);
    }
    for (const s of r.do) this.statement(s, locals);
  }

  tile(t: TileDef): void {
    this.typeExpr(t.in);
    this.add("tile", t.errorBoundary ?? "", t.errorBoundaryPos);
    for (const sr of t.subRoutes ?? []) this.add("tile", sr.tile, sr.tilePos);
    this.tileExpr(t.body, t.in ? new Set(["$1"]) : new Set());
  }

  tileExpr(t: TileExpr | undefined, locals: ReadonlySet<string>): void {
    if (!t) return;
    switch (t.kind) {
      case "TileCall":
        this.add("tile", t.name, t.pos);
        for (const a of t.args) this.tileArg(a, locals);
        for (const p of t.props) {
          // Three props hold a definition NAME rather than a value expression.
          // Each mirrors a `typecheck` site that resolves the same way — see
          // `undef-reducer` for the first two and `undef-motion` for the third.
          if (HANDLER_NAMES.has(p.name) && p.value.kind === "Ref") {
            this.add("reducer", p.value.name, p.value.pos);
            continue;
          }
          if (t.name === "link" && p.name === "prefetch") {
            // §3.8: a bare ident or a string literal, both naming a reducer.
            if (p.value.kind === "Ref") this.add("reducer", p.value.name, p.value.pos);
            else if (p.value.kind === "Str") this.add("reducer", p.value.value, p.value.pos);
            continue;
          }
          if (p.name === "motion" && p.value.kind === "Str") {
            this.add("motion", p.value.value, p.value.pos);
            continue;
          }
          this.expr(p.value, locals);
        }
        return;
      case "TileFor": {
        this.expr(t.iter, locals);
        const inner = new Set(locals);
        inner.add(t.bind);
        this.tileExpr(t.body, inner);
        return;
      }
      case "TileWhen":
        this.expr(t.cond, locals);
        this.tileExpr(t.body, locals);
        return;
      case "TileIf":
        this.expr(t.cond, locals);
        this.tileExpr(t.consequent, locals);
        this.tileExpr(t.alternate, locals);
        return;
      case "TileMatch": {
        this.expr(t.scrutinee, locals);
        for (const arm of t.arms) this.tileExpr(arm.body, withPatternBinds(locals, arm.pattern));
        return;
      }
      default:
        return;
    }
  }

  /**
   * A tile argument is either a nested tile or a value expression, discriminated
   * only by its `kind` — the field is the same either way.
   */
  private tileArg(a: TileArg, locals: ReadonlySet<string>): void {
    const v = a.value;
    if (isTileExpr(v)) {
      // A named handler passed positionally (`button("x", onClick=inc)` lifts
      // through args too) still arrives as an Expr, so only real tiles land here.
      this.tileExpr(v, locals);
      return;
    }
    if (a.name !== undefined && HANDLER_NAMES.has(a.name) && v.kind === "Ref") {
      this.add("reducer", v.name, v.pos);
      return;
    }
    this.expr(v, locals);
  }

  /**
   * A `test` names the reducer or tile it drives, and its `given` / `expect`
   * blocks name slots, effects and tiles. None of that is type-checked, so a
   * rename that misses it leaves a test that still compiles and still passes
   * while asserting about a definition that no longer exists.
   */
  test(t: TestDef): void {
    if (t.testKind === "reducer-test") this.add("reducer", t.target ?? "", t.targetPos);
    if (t.testKind === "tile-test") this.add("tile", t.target ?? "", t.targetPos);
    this.testRecord(t.given);
    if (t.expect) {
      if (isTileExpr(t.expect)) this.tileExpr(t.expect, new Set());
      else this.testRecord(t.expect);
    }
    for (const v of t.forAll ?? []) this.typeExpr(v.type);
    const generated = new Set((t.forAll ?? []).map((v: { name: string }) => v.name));
    if (t.invariant) this.expr(t.invariant, generated);
    if (t.mocks) this.testRecord(t.mocks);
  }

  /**
   * A test's `given` / `expect` / `mocks` records are keyed BY definition name —
   * `{slots: {count: 0}}`, `{effects: [persist(…)]}`, `{event: {target: Btn}}` —
   * which is the opposite of an ordinary record literal, where the keys are
   * field names and only the values are expressions. Keys have no position of
   * their own in the AST, so they are reported as edges (which `refs` and
   * `remove --cascade` need) without a position (so `rename` leaves them alone
   * rather than rewriting the wrong span).
   */
  private testRecord(e: Expr | undefined): void {
    if (!e) return;
    if (e.kind === "RecordLit") {
      for (const f of e.fields) {
        if (f.name === "slots" && f.value.kind === "RecordLit") {
          for (const slot of f.value.fields) this.addUnpositioned("slot", slot.name);
        }
        if (f.name === "mocks" && f.value.kind === "RecordLit") {
          for (const eff of f.value.fields) this.addUnpositioned("effect", eff.name);
        }
        if (f.name === "target") {
          // A tile name is capitalised, so it parses as a `Variant`, not a `Ref`.
          if (f.value.kind === "Variant") this.add("tile", f.value.name, f.value.pos);
          else if (f.value.kind === "Ref") this.add("tile", f.value.name, f.value.pos);
        }
        this.testRecord(f.value);
      }
      return;
    }
    if (e.kind === "ListLit") {
      for (const i of e.items) this.testRecord(i);
      return;
    }
    if (e.kind === "Call" && !e.callee.includes(".")) {
      this.addUnpositioned("effect", e.callee);
      for (const a of e.args) this.testRecord(a);
      return;
    }
    this.expr(e, new Set());
  }

  /**
   * An edge with no source position: `refs` and `remove --cascade` see it,
   * `rename` cannot act on it. Better than dropping the edge (which is what
   * made a renamed slot leave a passing test asserting about a slot that no
   * longer exists) and better than inventing a position.
   */
  private addUnpositioned(layer: RefLayer, name: string): void {
    if (!this.index[layer].has(name)) return;
    this.out.push({ layer, name });
  }

  app(a: AppDef): void {
    for (const r of a.routes) this.add("tile", r.tile, r.tilePos);
    for (const e of a.init) {
      // An init entry's callee names an EFFECT, never a fn — so it must not go
      // through the generic expression walk, which would resolve it as a fn as
      // well. With a `fn` and an `effect` sharing a name, that produced two
      // references at one position, and renaming the fn silently repointed
      // `init` at an effect that no longer exists.
      if (e.kind === "Call" && !e.callee.includes(".")) {
        this.add("effect", e.callee, e.pos);
        for (const a2 of e.args) this.expr(a2, new Set());
        continue;
      }
      this.expr(e, new Set());
    }
    this.add("theme", a.theme ?? "", a.themePos);
    if (a.http) {
      this.expr(a.http.baseUrl, new Set());
      this.expr(a.http.headers, new Set());
      this.expr(a.http.timeout, new Set());
      this.expr(a.http.credentials, new Set());
      const at = a.http.reducerRefPos ?? {};
      this.add("reducer", a.http.on401 ?? "", at.on401);
      this.add("reducer", a.http.on403 ?? "", at.on403);
      this.add("reducer", a.http.on5xx ?? "", at.on5xx);
    }
  }
}

const TILE_EXPR_KINDS = new Set(["TileCall", "TileFor", "TileWhen", "TileIf", "TileMatch"]);

function isTileExpr(v: Expr | TileExpr): v is TileExpr {
  return TILE_EXPR_KINDS.has((v as TileExpr).kind);
}

function withPatternBinds(
  locals: ReadonlySet<string>,
  p: { kind: string; name?: string; binds?: string[]; items?: unknown[] },
): ReadonlySet<string> {
  const inner = new Set(locals);
  const walk = (pat: typeof p): void => {
    if (pat.kind === "PBind" && pat.name) inner.add(pat.name);
    if (pat.kind === "PVariant") for (const b of pat.binds ?? []) if (b !== "_") inner.add(b);
    if (pat.kind === "PTuple") for (const i of pat.items ?? []) walk(i as typeof p);
  };
  walk(p);
  return inner;
}
