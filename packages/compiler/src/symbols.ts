import { paramSubstitution, substituteType, unknownType } from "./assignable.ts";
import type { Def, Program, TypeDef, TypeExpr } from "./ast.ts";
import { assertNever } from "./ast.ts";

/**
 * The unions `defs` write, by each tag they declare. A union is a union wherever it is written —
 * a `type` body, or the type of a slot, a fn's parameter or result, an effect, a tile's `in=` or a
 * property test's `for-all` — and at any depth inside one. Each is listed as the type a value of
 * it is read as: the `type` by name where the union is its whole body, its parameters undecided,
 * and the union itself anywhere else.
 */
export function unionsByTag(defs: readonly Def[]): Map<string, TypeExpr[]> {
  const unions = new Map<string, TypeExpr[]>();
  const add = (union: TypeExpr, t: TypeExpr & { kind: "TypeUnion" }): void => {
    for (const v of t.variants) {
      unions.set(v.name, [...(unions.get(v.name) ?? []), union]);
      for (const p of v.payloads) walk(p);
    }
  };
  const walk = (t: TypeExpr): void => {
    switch (t.kind) {
      case "TypeUnion":
        add(t, t);
        return;
      case "TypeApp":
        for (const a of t.args) walk(a);
        return;
      case "TypeRecord":
        for (const f of t.fields) walk(f.type);
        return;
      case "TypeNominal":
      case "TypeRefinement":
        walk(t.inner);
        return;
      case "TypePrim":
      case "TypeRef":
        return;
      default:
        assertNever(t);
    }
  };
  for (const def of defs) {
    if (def.kind !== "TypeDef") {
      for (const t of typesWrittenIn(def)) walk(t);
      continue;
    }
    const open = def.params.map(() => unknownType(def.pos));
    const body = substituteType(def.body, paramSubstitution(def.params, open));
    if (body.kind !== "TypeUnion") walk(body);
    else if (open.length === 0) add({ kind: "TypeRef", name: def.name, pos: def.pos }, body);
    else add({ kind: "TypeApp", name: def.name, args: open, pos: def.pos }, body);
  }
  return unions;
}

function typesWrittenIn(def: Def): TypeExpr[] {
  switch (def.kind) {
    case "TypeDef":
      return [def.body];
    case "SlotDef":
      return [def.type];
    case "TileDef":
      return def.in ? [def.in] : [];
    case "FnDef":
      return [...def.params.map((p) => p.type), ...(def.ret ? [def.ret] : [])];
    case "EffectDef":
      return [def.inType, def.outType];
    case "TestDef":
      return (def.forAll ?? []).map((f) => f.type);
    case "ReducerDef":
    case "AppDef":
    case "ThemeDef":
    case "MotionDef":
      return [];
    default:
      assertNever(def);
      return [];
  }
}

export function collectTimerNames(program: Program): Set<string> {
  const timers = new Set<string>();
  for (const def of program.defs) {
    if (def.kind !== "ReducerDef") continue;
    if (def.on.kind !== "TimerEvent") continue;
    if (def.on.name !== undefined) timers.add(def.on.name);
  }
  return timers;
}

export function variantTagsOf(scrutTypeName: string, program: Program): string[] | null {
  const bare = extractBareName(scrutTypeName);
  if (bare === null) return null;
  if (bare === "Option") return ["Some", "None"];
  if (bare === "Result") return ["Ok", "Err"];
  return collectTagsForTypeName(bare, program, new Set<string>());
}

function extractBareName(s: string): string | null {
  const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(s);
  return m ? m[1]! : null;
}

function collectTagsForTypeName(
  name: string,
  program: Program,
  seen: Set<string>,
): string[] | null {
  if (seen.has(name)) return null;
  const def = program.defs.find((d): d is TypeDef => d.kind === "TypeDef" && d.name === name);
  if (!def) return null;
  const next = new Set(seen);
  next.add(name);
  return resolveTags(def.body, program, next);
}

function resolveTags(t: TypeExpr, program: Program, seen: Set<string>): string[] | null {
  switch (t.kind) {
    case "TypeUnion":
      return t.variants.map((v) => v.name);
    case "TypeRef":
      if (t.name === "Option") return ["Some", "None"];
      if (t.name === "Result") return ["Ok", "Err"];
      return collectTagsForTypeName(t.name, program, seen);
    case "TypeApp":
      if (t.name === "Option") return ["Some", "None"];
      if (t.name === "Result") return ["Ok", "Err"];
      return collectTagsForTypeName(t.name, program, seen);
    case "TypeNominal":
    case "TypeRefinement":
      return resolveTags(t.inner, program, seen);
    default:
      return null;
  }
}
