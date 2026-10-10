import type { Program, TypeDef, TypeExpr } from "./ast.ts";

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
