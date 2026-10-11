import type {
  AppDef,
  Def,
  DuplicateName,
  EffectDef,
  Expr,
  FnDef,
  Pos,
  Program,
  Statement,
  TestDef,
  TileExpr,
  TypeDef,
  TypeExpr,
} from "./ast.ts";
import { isTileExpr, numberLiteral } from "./ast.ts";

const DUPLICATE_KINDS = {
  clause: { kind: "duplicate-clause", noun: "clause" },
  key: { kind: "duplicate-key", noun: "key" },
  field: { kind: "duplicate-field", noun: "field" },
  param: { kind: "duplicate-param", noun: "parameter" },
  variant: { kind: "duplicate-variant", noun: "variant" },
} as const;

export type DuplicateKind = keyof typeof DUPLICATE_KINDS;

/** One finding: a name written twice, and enough to phrase the message. */
export type Duplicate = {
  readonly kind: DuplicateKind;
  /** What kind of thing it is, in the reader's words: `"Record field"`. */
  readonly what: string;
  readonly within?: string;
  readonly name: string;
  readonly pos: Pos;
};

export function describeDuplicate(d: Duplicate): { kind: string; message: string; pos: Pos } {
  const within = d.within === undefined ? "" : ` in ${d.within}`;
  return {
    kind: DUPLICATE_KINDS[d.kind].kind,
    message: `${d.what} "${d.name}" is written more than once${within}`,
    pos: d.pos,
  };
}

function duplicatesIn(declared: readonly DuplicateName[]): readonly DuplicateName[] {
  const seen = new Set<string>();
  const out: DuplicateName[] = [];
  for (const d of declared) {
    if (seen.has(d.name)) out.push(d);
    else seen.add(d.name);
  }
  return out;
}

/** Accumulates findings so each site can state only what it declares. */
class Finder {
  readonly found: Duplicate[] = [];

  /** From a construct's full declaration list — the duplicates are derived. */
  declared<T>(
    items: readonly T[],
    kind: DuplicateKind,
    what: string,
    nameOf: (item: T) => string,
    posOf: (item: T) => Pos,
    within?: string,
  ): void {
    this.duplicates(
      duplicatesIn(items.map((i) => ({ name: nameOf(i), pos: posOf(i) }))),
      kind,
      what,
      within,
    );
  }

  duplicates(
    found: readonly DuplicateName[],
    kind: DuplicateKind,
    what: string,
    within?: string,
  ): void {
    for (const d of found) {
      this.found.push({ kind, what, name: d.name, pos: d.pos, ...(within ? { within } : {}) });
    }
  }
}

const LAYER_OF_DEF = {
  TypeDef: "type",
  SlotDef: "slot",
  ReducerDef: "reducer",
  TileDef: "tile",
  FnDef: "fn",
  EffectDef: "effect",
  ThemeDef: "theme",
  MotionDef: "motion",
  TestDef: "test",
} as const satisfies Record<Exclude<Def["kind"], "AppDef">, string>;

/** A definition declared more than once in its layer. */
export type DuplicateDefinition = { readonly layer: string } & DuplicateName;

export function findDuplicateDefinitions(program: Program): readonly DuplicateDefinition[] {
  const byLayer = new Map<string, DuplicateName[]>();
  for (const def of program.defs) {
    if (def.kind === "AppDef") continue;
    const layer = LAYER_OF_DEF[def.kind];
    const declared = byLayer.get(layer);
    if (declared) declared.push({ name: def.name, pos: def.pos });
    else byLayer.set(layer, [{ name: def.name, pos: def.pos }]);
  }
  const out: DuplicateDefinition[] = [];
  for (const [layer, declared] of byLayer) {
    for (const d of duplicatesIn(declared)) out.push({ layer, ...d });
  }
  return out;
}

export function duplicateSubRoutes(
  subRoutes: readonly { path: string; pathPos: Pos }[],
): readonly DuplicateName[] {
  return duplicatesIn(subRoutes.map((r) => ({ name: r.path, pos: r.pathPos })));
}

/** Every name a program declares twice inside one construct. */
export function findDuplicateNames(program: Program): readonly Duplicate[] {
  const f = new Finder();
  for (const def of program.defs) walkDef(def, f);
  return f.found;
}

function walkDef(def: Def, f: Finder): void {
  switch (def.kind) {
    case "TypeDef":
      walkTypeDef(def, f);
      return;
    case "SlotDef":
      walkType(def.type, f);
      walkExpr(def.init, f);
      return;
    case "FnDef":
      walkFn(def, f);
      return;
    case "EffectDef":
      walkEffect(def, f);
      return;
    case "TileDef":
      f.duplicates(def.duplicateClauses ?? [], "clause", "tile clause");
      if (def.in) walkType(def.in, f);
      walkTile(def.body, f);
      return;
    case "ReducerDef":
      for (const stmt of def.do) walkStatement(stmt, f);
      return;
    case "AppDef":
      walkApp(def, f);
      return;
    case "ThemeDef":
    case "MotionDef":
      f.duplicates(
        def.duplicateKeys ?? [],
        "key",
        `${def.kind === "ThemeDef" ? "theme" : "motion"} key`,
      );
      return;
    case "TestDef":
      walkTest(def, f);
      return;
    default: {
      const exhaustive: never = def;
      void exhaustive;
      return;
    }
  }
}

function walkTypeDef(def: TypeDef, f: Finder): void {
  f.declared(
    def.params,
    "param",
    "Parameter",
    (name) => name,
    () => def.pos,
    `type "${def.name}"`,
  );
  walkType(def.body, f);
}

function walkFn(def: FnDef, f: Finder): void {
  f.declared(
    def.params,
    "param",
    "Parameter",
    (p) => p.name,
    (p) => p.pos,
    `fn "${def.name}"`,
  );
  for (const p of def.params) walkType(p.type, f);
  if (def.ret) walkType(def.ret, f);
  walkExpr(def.body, f);
}

function walkEffect(def: EffectDef, f: Finder): void {
  f.duplicates(def.duplicateClauses ?? [], "clause", "effect clause");
  walkType(def.inType, f);
  walkType(def.outType, f);
  if (def.policy?.kind === "PolLatestKey") walkExpr(def.policy.key, f);
  walkExpr(def.mapRequest, f);
}

function walkApp(def: AppDef, f: Finder): void {
  f.duplicates(def.duplicateClauses ?? [], "clause", "app clause");
  f.declared(
    def.routes,
    "key",
    "Route pattern",
    (r) => r.path,
    (r) => r.pathPos,
  );
  for (const e of def.init) walkExpr(e, f);
  for (const src of def.configSources ?? []) walkExpr(src, f);
}

function walkTest(def: TestDef, f: Finder): void {
  f.declared(
    def.forAll ?? [],
    "param",
    "Generator",
    (g) => g.name,
    (g) => g.pos,
    `test "${def.name}"`,
  );
  for (const g of def.forAll ?? []) walkType(g.type, f);
  walkExpr(def.given, f);
  walkExpr(def.invariant, f);
  walkExpr(def.mocks, f);
  if (def.expect === undefined) return;
  if (isTileExpr(def.expect)) walkTile(def.expect, f);
  else walkExpr(def.expect, f);
}

function walkTile(t: TileExpr | undefined, f: Finder): void {
  if (!t) return;
  switch (t.kind) {
    case "TileCall":
      f.declared(
        t.args.filter((a) => a.name !== undefined),
        "key",
        "Tile argument",
        (a) => a.name as string,
        (a) => a.namePos ?? t.pos,
      );
      f.declared(
        t.props,
        "key",
        "Tile prop",
        (p) => p.name,
        (p) => p.pos,
      );
      for (const a of t.args) {
        if (isTileExpr(a.value)) walkTile(a.value, f);
        else walkExpr(a.value, f);
      }
      for (const p of t.props) walkExpr(p.value, f);
      return;
    case "TileFor":
      walkExpr(t.iter, f);
      walkTile(t.body, f);
      return;
    case "TileWhen":
      walkExpr(t.cond, f);
      walkTile(t.body, f);
      return;
    case "TileIf":
      walkExpr(t.cond, f);
      walkTile(t.consequent, f);
      walkTile(t.alternate, f);
      return;
    case "TileMatch":
      walkExpr(t.scrutinee, f);
      for (const arm of t.arms) walkTile(arm.body, f);
      return;
    default: {
      const exhaustive: never = t;
      void exhaustive;
      return;
    }
  }
}

function walkStatement(s: Statement, f: Finder): void {
  switch (s.kind) {
    case "SlotAssign":
      walkExpr(s.rhs, f);
      return;
    case "LetStmt":
      walkExpr(s.rhs, f);
      return;
    case "Emit":
      for (const a of s.args) walkExpr(a, f);
      return;
    case "ForStmt":
      walkExpr(s.iter, f);
      for (const b of s.body) walkStatement(b, f);
      return;
    case "IfStmt":
      walkExpr(s.cond, f);
      for (const b of s.consequent) walkStatement(b, f);
      for (const b of s.alternate) walkStatement(b, f);
      return;
    case "MatchStmt":
      walkExpr(s.scrutinee, f);
      for (const arm of s.arms) for (const b of arm.body) walkStatement(b, f);
      return;
    case "PanicStmt":
      walkExpr(s.message, f);
      return;
    case "NoopStmt":
    case "StopTimer":
      return;
    default: {
      const exhaustive: never = s;
      void exhaustive;
      return;
    }
  }
}

function literalKey(e: Expr): { compare: string; shown: string } | null {
  if (e.kind === "Str") return { compare: `s:${e.value}`, shown: e.value };
  const n = numberLiteral(e);
  if (n !== null) return { compare: `n:${n.value}`, shown: String(n.value) };
  return null;
}

function walkExpr(e: Expr | undefined, f: Finder): void {
  if (!e) return;
  switch (e.kind) {
    case "RecordLit":
      f.declared(
        e.fields,
        "key",
        "Record field",
        (fld) => fld.name,
        (fld) => fld.pos,
      );
      for (const fld of e.fields) walkExpr(fld.value, f);
      return;
    case "MapLit": {
      const literal = e.entries.flatMap((ent) => {
        const key = literalKey(ent.key);
        return key === null ? [] : [{ ...key, pos: ent.key.pos }];
      });
      for (const dup of duplicatesIn(literal.map((k) => ({ name: k.compare, pos: k.pos })))) {
        const shown = literal.find((k) => k.compare === dup.name && k.pos === dup.pos)?.shown;
        f.duplicates([{ name: shown ?? dup.name, pos: dup.pos }], "key", "Map key");
      }
      for (const ent of e.entries) {
        walkExpr(ent.key, f);
        walkExpr(ent.value, f);
      }
      return;
    }
    case "BinOp":
      walkExpr(e.lhs, f);
      walkExpr(e.rhs, f);
      return;
    case "UnaryOp":
      walkExpr(e.rhs, f);
      return;
    case "FieldAccess":
      walkExpr(e.base, f);
      return;
    case "Index":
      walkExpr(e.base, f);
      walkExpr(e.index, f);
      return;
    case "Call":
    case "EmitExpr":
      for (const a of e.args) walkExpr(a, f);
      return;
    case "MethodCall":
      walkExpr(e.receiver, f);
      for (const a of e.args) walkExpr(a, f);
      return;
    case "ListLit":
    case "TupleLit":
      for (const it of e.items) walkExpr(it, f);
      return;
    case "MatchExpr":
      walkExpr(e.scrutinee, f);
      for (const arm of e.arms) walkExpr(arm.body, f);
      return;
    case "IfExpr":
      walkExpr(e.cond, f);
      walkExpr(e.consequent, f);
      walkExpr(e.alternate, f);
      return;
    case "LetIn":
      walkExpr(e.value, f);
      walkExpr(e.body, f);
      return;
    case "Variant":
      for (const p of e.payload) walkExpr(p, f);
      return;
    default:
      // Leaves (`Ref`, `Str`, `Num`, `Bool`, `Unit`, `Wildcard`, `TokenRef`)
      // and anything with no sub-expressions declare no names.
      return;
  }
}

function walkType(t: TypeExpr | undefined, f: Finder): void {
  if (!t) return;
  switch (t.kind) {
    case "TypeRecord":
      f.declared(
        t.fields,
        "field",
        "Record type field",
        (fld) => fld.name,
        (fld) => fld.pos,
      );
      for (const fld of t.fields) walkType(fld.type, f);
      return;
    case "TypeUnion":
      f.declared(
        t.variants,
        "variant",
        "Union variant",
        (v) => v.name,
        (v) => v.pos,
      );
      for (const v of t.variants) for (const p of v.payloads) walkType(p, f);
      return;
    case "TypeApp":
      for (const a of t.args) walkType(a, f);
      return;
    case "TypeNominal":
    case "TypeRefinement":
      walkType(t.inner, f);
      return;
    default:
      return;
  }
}
