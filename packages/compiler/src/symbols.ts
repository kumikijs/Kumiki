// Read-only symbol lookups exposed to tooling (e.g. `kumiki fix`) that needs
// scoped candidate sets for did-you-mean suggestions. Pure AST walkers — no
// dependency on typecheck's internal `SymbolTable`, so they run on a freshly
// parsed `Program` without re-typechecking.

import type { Def, Program, TypeDef, TypeExpr } from "./ast.ts";
import { assertNever } from "./ast.ts";
import { QUALIFIED_CALL_NAMESPACES } from "./builtin-calls.ts";
import {
  BUILTIN_TYPE_CONSTRUCTORS,
  BUILTIN_UNION_TAGS,
  STDLIB_TYPES,
  typeCandidates,
} from "./stdlib-types.ts";

/**
 * Every tag a variant constructor may name, the program's own first: the tags
 * of each union written anywhere in its types — a `type` body, or inline in a
 * slot's type, a record field, a `fn` parameter or result, an `in=` / `out=`,
 * a `for-all` generator — and then the standard library's, `STDLIB_TYPES`'
 * unions and `BUILTIN_UNION_TAGS`.
 *
 * A capitalised name in an expression is a `Variant`, and codegen builds one
 * from any spelling (`{_tag: "<name>"}`), so this set is the whole difference
 * between a constructor and a record nothing reads: the checker resolves a
 * `Variant` against it (E0116 `undef-variant`) and `kumiki fix` repairs one
 * from it, so the suggestion a diagnostic prints is the name `fix` writes.
 */
export function constructorTags(program: Program): string[] {
  const tags = new Set<string>();
  for (const def of program.defs) {
    for (const t of typesWrittenIn(def)) collectUnionTags(t, tags);
  }
  for (const def of STDLIB_TYPES) collectUnionTags(def.body, tags);
  for (const builtin of BUILTIN_UNION_TAGS.values()) for (const tag of builtin) tags.add(tag);
  return [...tags];
}

/**
 * Every name the qualifier of a bare `Q.member` can resolve to (E0116
 * `undef-qualifier`): a tag, whose member is read off the value it builds
 * (`Idle.show`); a type, whose member is read as written (`Time.now` — and a
 * bare `Int.parse`, the field read `docs/spec/errors.md` E0116 records as a
 * known gap); and the namespaces whose members are calls (`Decoder.None`). The parser reads a namespace's member as
 * a call before it is ever a qualifier, but a misspelt one is exactly the name
 * whose closest candidate is that namespace.
 */
export function qualifierCandidates(program: Program): string[] {
  const userTypes = program.defs.filter((d) => d.kind === "TypeDef").map((d) => d.name);
  return [...constructorTags(program), ...QUALIFIED_CALL_NAMESPACES, ...typeCandidates(userTypes)];
}

/** The types a definition writes, at the top of each position that takes one. */
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

/**
 * The tags of a generic constructor that is a union — `Option`'s and
 * `Result`'s — which have no definition to read them from. `null` for every
 * other name, a generic constructor that is no union (`List`) included.
 */
function genericUnionTags(name: string): string[] | null {
  const tags = BUILTIN_TYPE_CONSTRUCTORS.has(name) ? BUILTIN_UNION_TAGS.get(name) : undefined;
  return tags ? [...tags] : null;
}

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
