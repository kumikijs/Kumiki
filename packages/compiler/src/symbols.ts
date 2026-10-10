import type { Def, Program, TypeDef, TypeExpr } from "./ast.ts";
import { assertNever } from "./ast.ts";
import { QUALIFIED_CALL_NAMESPACES } from "./builtin-calls.ts";
import {
  BUILTIN_TYPE_CONSTRUCTORS,
  BUILTIN_UNION_TAGS,
  STDLIB_TYPES,
  typeCandidates,
} from "./stdlib-types.ts";

// Codegen builds a variant from any spelling, so this set is the whole difference
// between a constructor and a record nothing reads. The checker and `kumiki fix`
// both read it, so the name a diagnostic suggests is the one `fix` writes.
export function constructorTags(program: Program): string[] {
  const tags = new Set<string>();
  for (const def of program.defs) {
    for (const t of typesWrittenIn(def)) collectUnionTags(t, tags);
  }
  for (const def of STDLIB_TYPES) collectUnionTags(def.body, tags);
  for (const builtin of BUILTIN_UNION_TAGS.values()) for (const tag of builtin) tags.add(tag);
  return [...tags];
}

// The call namespaces are included although the parser reads their members as
// calls: a misspelt one is exactly the name whose closest candidate is that namespace.
export function qualifierCandidates(program: Program): string[] {
  const userTypes = program.defs.filter((d) => d.kind === "TypeDef").map((d) => d.name);
  return [...constructorTags(program), ...QUALIFIED_CALL_NAMESPACES, ...typeCandidates(userTypes)];
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

function collectUnionTags(t: TypeExpr, out: Set<string>): void {
  switch (t.kind) {
    case "TypeUnion":
      for (const v of t.variants) {
        out.add(v.name);
        for (const p of v.payloads) collectUnionTags(p, out);
      }
      return;
    case "TypeApp":
      for (const a of t.args) collectUnionTags(a, out);
      return;
    case "TypeRecord":
      for (const f of t.fields) collectUnionTags(f.type, out);
      return;
    case "TypeNominal":
    case "TypeRefinement":
      collectUnionTags(t.inner, out);
      return;
    case "TypePrim":
    case "TypeRef":
      return;
    default:
      assertNever(t);
  }
}

function genericUnionTags(name: string): string[] | null {
  const tags = BUILTIN_TYPE_CONSTRUCTORS.has(name) ? BUILTIN_UNION_TAGS.get(name) : undefined;
  return tags ? [...tags] : null;
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
  return genericUnionTags(bare) ?? collectTagsForTypeName(bare, program, new Set<string>());
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
    case "TypeApp":
      return genericUnionTags(t.name) ?? collectTagsForTypeName(t.name, program, seen);
    case "TypeNominal":
    case "TypeRefinement":
      return resolveTags(t.inner, program, seen);
    default:
      return null;
  }
}
