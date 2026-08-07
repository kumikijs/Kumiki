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
  /** Position of the identifier token itself, so a rewrite can be exact. */
  pos: Pos;
};

/** Definition names by layer, for resolving a bare name to a definition. */
export type DefIndex = Record<RefLayer, Set<string>>;

const LAYER_OF_DEF: Partial<Record<Def["kind"], RefLayer>> = {
  TypeDef: "type",
  SlotDef: "slot",
  EffectDef: "effect",
  ReducerDef: "reducer",
  TileDef: "tile",
  FnDef: "fn",
  ThemeDef: "theme",
  MotionDef: "motion",
};

/** The layer a definition occupies, or null for `app` / `test` (never referenced). */
export function layerOfDef(def: Def): RefLayer | null {
  return LAYER_OF_DEF[def.kind] ?? null;
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
    default:
      // `theme` / `motion` / `test` bodies reference no definitions by name.
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
        // `TodoId.fresh()` and `math.abs(x)` are qualified — only an unqualified
        // callee can name a `fn` definition.
        if (!e.callee.includes(".")) this.add("fn", e.callee, e.pos);
        for (const a of e.args) this.expr(a, locals);
        return;
      case "MethodCall":
        this.expr(e.receiver, locals);
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
        for (const a of s.args) this.expr(a, locals);
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

  reducer(r: ReducerDef): void {
    const locals = new Set<string>(["$el", "$event", "$route", "$now"]);
    if (r.on.kind === "UiEvent") {
      this.add("tile", r.on.selector.tile, r.on.selector.tilePos);
    } else if (r.on.kind === "EffectEvent") {
      this.add("effect", r.on.effect, r.on.effectPos);
      for (const b of r.on.binds) if (b !== "_") locals.add(b);
    } else if (r.on.kind === "LifecycleEvent") {
      const m = r.on.name.match(/^tile\.(?:un)?mount\("([^"]+)"\)$/);
      // The tile name is embedded in the event name and has no position of its
      // own; `refs` still needs the edge, so report it at the pattern.
      if (m?.[1]) this.add("tile", m[1], r.on.pos);
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
          // A handler prop's value is a reducer name, not a slot read — the one
          // place a bare identifier means something other than a value.
          if (HANDLER_NAMES.has(p.name) && p.value.kind === "Ref") {
            this.add("reducer", p.value.name, p.value.pos);
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

  app(a: AppDef): void {
    for (const r of a.routes) this.add("tile", r.tile, r.tilePos);
    for (const e of a.init) this.expr(e, new Set());
    // `init = [loadNote(k)]` parses as a Call, whose callee names an effect
    // rather than a fn — the one position where that is true.
    for (const e of a.init) {
      if (e.kind === "Call" && !e.callee.includes(".")) this.add("effect", e.callee, e.pos);
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
