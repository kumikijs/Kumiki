// A name declared twice, everywhere a name can be declared.
//
// Every site had the same shape and the same outcome: an assignment into a map
// or a variable, with no check that the key was free, so the later declaration
// won and the earlier one left no trace. Timer names were the sole exception
// (`E0002`), which made the policy read as deliberate when it was not.
//
// The rule is stated once, and the walk that applies it is structural: it
// descends every definition to every expression, type, tile and test body,
// rather than riding along on checks that happen to visit some of them. The
// first version of this did ride along, and the constructs no existing walk
// reached — a tile's clauses, a test's `given`, an `app.meta` record, a
// `for-all` — were silently exempt from a rule the spec stated without
// exception.
//
// What the walk cannot see, the parser records: `app` / `effect` / `tile`
// clauses and theme records are assembled into a single field or record, so
// the loser is gone by the time the tree exists. Those arrive as
// `duplicateClauses` / `duplicateKeys` — already the duplicates, not the
// declarations.

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
import { isTileExpr } from "./ast.ts";

/**
 * What was written twice, and what to call it.
 *
 * `kind` is the diagnostic's machine-readable classification and `noun` is
 * what its message says, so the two cannot be paired wrongly — every entry of
 * this table corresponds to one row of the `E0008` table in
 * `docs/spec/errors.md`.
 */
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
  /**
   * The definition it sits in, when the position alone would not identify it.
   * A parameter belongs to a `fn` or a `type`; a record field belongs to
   * whatever record it was written in, which the position already says.
   */
  readonly within?: string;
  readonly name: string;
  readonly pos: Pos;
};

/**
 * The `kind` and `message` a finding produces. The `code` is added by the
 * typechecker: every coded diagnostic is emitted from one file, which
 * `errors.md` states and `spec-drift.test.ts` enforces.
 */
export function describeDuplicate(d: Duplicate): { kind: string; message: string; pos: Pos } {
  const within = d.within === undefined ? "" : ` in ${d.within}`;
  return {
    kind: DUPLICATE_KINDS[d.kind].kind,
    message: `${d.what} "${d.name}" is written more than once${within}`,
    pos: d.pos,
  };
}

/**
 * The declarations past the first for each name declared more than once, in
 * source order.
 *
 * The *later* one is reported: it is the one to delete, and the earlier one is
 * what the reader meant to keep. Reporting every occurrence past the first
 * (rather than only the second) means a name written three times produces two
 * findings, which is how many edits it takes.
 */
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

  /**
   * From a list that is *already* the duplicates — what the parser recorded
   * for a construct that keeps only the winner. Narrowing these again would
   * discard them: they hold one entry per duplicated name, not one per
   * declaration.
   */
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

/**
 * The layer each definition kind occupies — the namespace `E0007` is per.
 *
 * Exhaustive over `Def["kind"]` minus `AppDef`, so a definition kind added to
 * the language is a compile error here rather than a layer that quietly keeps
 * the old last-one-wins behaviour. `app` is excluded because `E0004` covers
 * it, and a code's meaning is permanent.
 */
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

/**
 * Two definitions of one layer sharing a name.
 *
 * Over `program.defs` rather than over the symbol tables, for two reasons the
 * tables cannot give: they are seeded with the standard library's types, so a
 * program's own `type Route = Text` would read as a redeclaration of a name it
 * is entitled to shadow; and they are per layer already, so a `slot` and a
 * `tile` sharing a name — which is legal, and which code generation relies on
 * — would need to be excluded by hand.
 */
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

/**
 * The sub-route paths a tile declares more than once.
 *
 * `E0112` predates `E0008` and keeps its own code, but not its own rule: this
 * is the same `duplicatesIn` every other construct goes through, so "reported
 * at the later occurrence, once per occurrence past the first" is true of
 * sub-routes as well.
 */
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
      // `sub-routes` is absent on purpose: `E0112` already covers a repeated
      // sub-route path and its code is permanent, so reporting it here too
      // would be two diagnostics for one mistake. It reads the same rule —
      // see `duplicateSubRoutes`.
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
      // A literal record with no expressions in it — the parser is the only
      // place a duplicate key is still visible.
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
      // A new `Def` kind must be walked here rather than silently exempted —
      // being exempt is the state this whole module exists to end.
      const exhaustive: never = def;
      void exhaustive;
      return;
    }
  }
}

function walkTypeDef(def: TypeDef, f: Finder): void {
  // A type's parameters are bare names in the tree, so the definition is the
  // only position available — which still names the parameter and the type.
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
  // `meta` / `http` / `indexed-db` / `analytics` are folded into narrowed
  // config objects that keep only the fields they recognise; the record they
  // were folded from is kept alongside precisely so this can still see it.
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
      // Both lists survive in the tree, and both lose differently at runtime:
      // props lower to an object literal (later wins) while a named argument
      // is read with `.find` (earlier wins). One call can therefore resolve
      // two duplicated names in opposite directions.
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

/**
 * A literal key: what to compare it by, and what to call it in a message.
 *
 * Two keys are the same only if their *kind* agrees too — `{"1": …, 1: …}` is
 * a Text key beside an Int key, which JavaScript would collapse but the
 * language does not.
 */
function literalKey(e: Expr): { compare: string; shown: string } | null {
  if (e.kind === "Str") return { compare: `s:${e.value}`, shown: e.value };
  if (e.kind === "Num") return { compare: `n:${e.value}`, shown: String(e.value) };
  // `-1` parses as a negation of a literal, which is still a literal key.
  if (e.kind === "UnaryOp" && e.op === "-" && e.rhs.kind === "Num") {
    return { compare: `n:${-e.rhs.value}`, shown: String(-e.rhs.value) };
  }
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
      // Only literal keys can be compared, and by kind as well as by text:
      // `{"1": …, 1: …}` is two keys, not one written twice. A computed key
      // is the runtime's question and the answer is not available here.
      const literal = e.entries.flatMap((ent) => {
        const key = literalKey(ent.key);
        return key === null ? [] : [{ ...key, pos: ent.key.pos }];
      });
      // Compared on `compare`, reported with `shown` — the reader looks for
      // the key as they wrote it, not for the tag that distinguishes kinds.
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
      // A tag written twice makes one arm of every `match` on this union
      // unreachable, and which one depends on resolution order.
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
