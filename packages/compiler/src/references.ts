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
import { assertNever, isTileExpr } from "./ast.ts";
import { eventParts, recordFieldsOf, testSections } from "./test-sections.ts";
import { HANDLER_NAMES, handlerReducerName } from "./ui-lifts.ts";

/** The layers a name can denote. `app` and `test` are never referenced by name. */
export type RefLayer = "type" | "slot" | "effect" | "reducer" | "tile" | "fn" | "theme" | "motion";

export type Reference = {
  layer: RefLayer;
  name: string;
  pos?: Pos;
};

/** Definition names by layer, for resolving a bare name to a definition. */
export type DefIndex = Record<RefLayer, Set<string>>;

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

export function referencesIn(def: Def, index: DefIndex): Reference[] {
  const out: Reference[] = [];
  const w = new Walker(index, out, def.kind === "TestDef");
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
    // Outside a test body a `<slots.X>` is E0109 and reads nothing, so an edge there would be a
    // read that does not happen, which E0304 would report a second time.
    private readonly wildcardsNameSlots: boolean,
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
        this.add("type", t.name, t.pos);
        for (const a of t.args) this.typeExpr(a);
        return;
      case "TypeRecord":
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
        // `run-reducer(name)` takes a reducer NAME, not a value.
        if (e.callee === "run-reducer") {
          this.runReducerArg(e.args[0]);
          return;
        }
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
      case "TupleLit":
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
      case "Wildcard":
        // The name is spelled as a slot's, never a bare one, so no local can
        // shadow it.
        if (e.wild === "slot" && this.wildcardsNameSlots) this.add("slot", e.slot, e.slotPos);
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
      case "PanicStmt":
        this.expr(s.message, locals);
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
      for (const b of r.on.binds) if (b.name !== "_") locals.add(b.name);
    } else if (r.on.kind === "LifecycleEvent" && r.on.tileTarget) {
      this.add("tile", r.on.tileTarget.name, r.on.tileTarget.pos);
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
          if (HANDLER_NAMES.has(p.name)) {
            const reducer = handlerReducerName(p.value);
            if (reducer !== null) {
              this.add("reducer", reducer, p.value.pos);
              continue;
            }
          }
          if (t.name === "link" && p.name === "prefetch") {
            // A bare ident or a string literal, both naming a reducer.
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

  private tileArg(a: TileArg, locals: ReadonlySet<string>): void {
    const v = a.value;
    if (a.name !== undefined && HANDLER_NAMES.has(a.name)) {
      const reducer = handlerReducerName(v);
      if (reducer !== null) {
        this.add("reducer", reducer, v.pos);
        return;
      }
    }
    if (isTileExpr(v)) {
      this.tileExpr(v, locals);
      return;
    }
    this.expr(v, locals);
  }

  test(t: TestDef): void {
    if (t.testKind === "reducer-test") this.add("reducer", t.target ?? "", t.targetPos);
    if (t.testKind === "tile-test") this.add("tile", t.target ?? "", t.targetPos);
    for (const v of t.forAll ?? []) this.typeExpr(v.type);
    const generated = new Set((t.forAll ?? []).map((v: { name: string }) => v.name));
    for (const { section, value } of testSections(t, t.testKind, "given")) {
      switch (section) {
        case "slots":
          this.slotValues(value, generated);
          break;
        case "event": {
          const { tile, payload } = eventParts(value);
          if (tile) this.add("tile", tile.name, tile.pos);
          for (const f of payload) this.expr(f.value, generated);
          break;
        }
        case "mocks":
          this.mocks(value, generated);
          break;
        case "in":
          this.expr(value, generated);
          break;
        default:
          assertNever(section);
      }
    }
    // A tile-test's `expect` is a tile expression, with no sections.
    if (t.expect && isTileExpr(t.expect)) this.tileExpr(t.expect, new Set());
    for (const { section, value } of testSections(t, t.testKind, "expect")) {
      switch (section) {
        case "slots":
        case "slots-equal":
          this.slotValues(value, generated);
          break;
        case "effects":
          this.expectedEffects(value, generated);
          break;
        case "panic":
        case "no-panics":
        case "no-errors":
          this.expr(value, generated);
          break;
        default:
          assertNever(section);
      }
    }
    if (t.invariant) this.expr(t.invariant, generated);
    if (t.mocks) this.mocks(t.mocks, generated);
  }

  private slotValues(rec: Expr, locals: ReadonlySet<string>): void {
    for (const f of recordFieldsOf(rec)) {
      this.addUnpositioned("slot", f.name);
      this.expr(f.value, locals);
    }
  }

  private expectedEffects(list: Expr, locals: ReadonlySet<string>): void {
    if (list.kind !== "ListLit") return;
    for (const entry of list.items) {
      if (entry.kind === "Call") {
        this.add("effect", entry.callee, entry.pos);
        for (const a of entry.args) this.expr(a, locals);
      } else if (entry.kind === "Ref") {
        this.add("effect", entry.name, entry.pos);
      }
    }
  }

  private mocks(rec: Expr, locals: ReadonlySet<string>): void {
    for (const m of recordFieldsOf(rec)) {
      this.addUnpositioned("effect", m.name);
      this.mockScript(m.value, locals);
    }
  }

  // `ok` / `err` / `delay` are the mock's own vocabulary, never a fn of the same name.
  private mockScript(v: Expr, locals: ReadonlySet<string>): void {
    if (v.kind !== "Call") return;
    if (v.callee === "ok" || v.callee === "err") {
      for (const a of v.args) this.expr(a, locals);
    } else if (v.callee === "delay") {
      const [ms, outcome] = v.args;
      this.expr(ms, locals);
      if (outcome) this.mockScript(outcome, locals);
    }
  }

  private addUnpositioned(layer: RefLayer, name: string): void {
    if (!this.index[layer].has(name)) return;
    this.out.push({ layer, name });
  }

  app(a: AppDef): void {
    for (const r of a.routes) this.add("tile", r.tile, r.tilePos);
    for (const e of a.init) {
      if (e.kind === "Call" && !e.callee.includes(".")) {
        this.add("effect", e.callee, e.pos);
        for (const a2 of e.args) this.expr(a2, new Set());
        continue;
      }
      this.expr(e, new Set());
    }
    if (a.theme) {
      const layer = this.index.theme.has(a.theme.name) ? "theme" : "slot";
      this.add(layer, a.theme.name, a.theme.pos);
    }
    if (a.http) {
      this.expr(a.http.baseUrl, new Set());
      this.expr(a.http.headers, new Set());
      this.expr(a.http.timeout, new Set());
      this.expr(a.http.credentials, new Set());
      for (const h of [a.http.on401, a.http.on403, a.http.on5xx]) {
        if (h) this.add("reducer", h.name, h.pos);
      }
    }
  }
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
