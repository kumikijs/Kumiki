// Read-only symbol lookups exposed to tooling (e.g. `kumiki fix`) that needs
// scoped candidate sets for did-you-mean suggestions. Pure AST walkers — no
// dependency on typecheck's internal `SymbolTable`, so they run on a freshly
// parsed `Program` without re-typechecking.

import type { Program, TypeDef, TypeExpr } from "./ast.ts";

/**
 * Timer names declared via `on=timer(d, name=N)` on any `ReducerDef` in the
 * program. Mirrors the collection done by typecheck's first pass, minus the
 * `E0002 duplicate-timer-name` diagnostic — duplicates collapse into a single
 * `Set` entry, which is exactly what a suggestion consumer wants.
 */
export function collectTimerNames(program: Program): Set<string> {
  const timers = new Set<string>();
  for (const def of program.defs) {
    if (def.kind !== "ReducerDef") continue;
    if (def.on.kind !== "TimerEvent") continue;
    if (def.on.name !== undefined) timers.add(def.on.name);
  }
  return timers;
}

/**
 * Variant tag list for a scrutinee type given by its rendered name, or `null`
 * when the type either isn't a union shape or isn't reachable from the
 * program.
 *
 * `scrutTypeName` is the exact string produced by typecheck's `typeToString`
 * in the E0209 error message — `"Light"`, `"Option(Int)"`,
 * `"Result(Int, Text)"`, or `"Foo(A, B)"` for user generics. We strip the
 * generic argument list (`"Option(Int)" -> "Option"`) before lookup: variant
 * tags don't depend on the argument instantiation.
 *
 * Built-in `Option` / `Result` are resolved directly; user types are looked
 * up in `program.defs` and their body is unwrapped through `TypeRef`,
 * `TypeApp`, `TypeNominal`, and `TypeRefinement` until a `TypeUnion` is
 * reached. Handles the tag names only — payload extraction and type-parameter
 * substitution (both done by typecheck's `lookupVariantPayloads`) are
 * intentionally omitted because tag identity is independent of both.
 *
 * Rendered shapes that `typeToString` can produce but are NOT expected to
 * reach this function in practice:
 *   - `"nominal <inner>"` for `TypeNominal` — `extractBareName` returns
 *     `"nominal"`, which is not a valid type identifier, so the lookup
 *     safely returns `null` (no suggestion, no wrong candidate set).
 *   - `"Red | Green"` for an anonymous `TypeUnion` — `extractBareName`
 *     returns the first tag (`"Red"`), which would silently look up a
 *     same-named `TypeDef` if one exists. Scrutinee expressions always type
 *     to a named `TypeRef` / `TypeApp` at the E0209 site, so this shape is
 *     unreachable from the CLI caller; if the invariant ever changes,
 *     rendering the union tags explicitly is safer than parsing.
 */
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
