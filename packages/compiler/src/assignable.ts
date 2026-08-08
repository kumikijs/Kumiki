// The assignability relation, and the type-level helpers it needs.
//
// `inferType` had existed since the receiver-inference work, but nothing ever
// compared its answer against a declared type — there was no `assignable` at
// all — so every promise in forms.md §5.6 was empty. The relation lives here,
// separate from `typecheck.ts`, because it is a pure question about two types:
// no symbol table beyond the type definitions, no expressions, no diagnostics.
// `typecheck.ts` owns the expression-directed half (`checkAgainst`), which is
// what produces positions and messages.
//
// Every rule is one-sided: it answers "is this definitely wrong?", never "is
// this definitely right?". An unresolvable name, an uninferable expression and
// an unsubstituted type parameter all read as `unknown`, and `unknown` is
// assignable in both directions. A false positive rejects a program that runs;
// a false negative only loses a diagnostic that never existed before.

import type { Pos, TypeDef, TypeExpr } from "./ast.ts";
import { BUILTIN_TYPE_CONSTRUCTORS } from "./stdlib-types.ts";

/** The slice of the checker's symbol table the type relation needs. */
export type TypeEnv = { types: ReadonlyMap<string, TypeDef> };

/**
 * The type of an expression whose type could not be worked out. Spelled as a
 * `TypeRef` to a name the grammar cannot produce, so it takes the same
 * "unresolved name is opaque" path as a type parameter with no substitution —
 * one rule instead of a separate case in every comparison.
 */
export const unknownType = (pos: Pos): TypeExpr => ({ kind: "TypeRef", name: "?", pos });

/** True when nothing can be concluded about `t` — an unresolved name, or absent. */
export function isOpaque(t: TypeExpr | null, env: TypeEnv): boolean {
  const u = unaliasType(t, env);
  return u === null || u.kind === "TypeRef";
}

/**
 * Reduce a type to the form comparisons are written against: aliases followed,
 * generic definitions instantiated, `nominal` / `where` wrappers stripped.
 *
 * A `TypeRef` that names nothing is returned as-is, which is how a type
 * parameter and a misspelling both become opaque. Recursion through an alias
 * cycle returns `null` rather than looping — cycle *detection* is issue #243's
 * job, and this must terminate regardless.
 */
export function unaliasType(
  t: TypeExpr | null,
  env: TypeEnv,
  seen: ReadonlySet<string> = new Set(),
): TypeExpr | null {
  if (!t) return null;
  if (t.kind === "TypeRef") {
    if (seen.has(t.name)) return null;
    const def = env.types.get(t.name);
    if (!def) return t;
    return unaliasType(def.body, env, new Set([...seen, t.name]));
  }
  if (t.kind === "TypeApp") {
    const def = env.types.get(t.name);
    // A stdlib constructor (`List`, `Option`, …) has no definition to expand
    // into and is already in its comparison form.
    if (!def || seen.has(t.name)) return t;
    const body = substituteType(def.body, paramSubstitution(def.params, t.args));
    return unaliasType(body, env, new Set([...seen, t.name]));
  }
  if (t.kind === "TypeNominal" || t.kind === "TypeRefinement")
    return unaliasType(t.inner, env, seen);
  return t;
}

export function paramSubstitution(params: string[], args: TypeExpr[]): Map<string, TypeExpr> {
  const sub = new Map<string, TypeExpr>();
  params.forEach((p, i) => {
    const a = args[i];
    if (a) sub.set(p, a);
  });
  return sub;
}

export function substituteType(t: TypeExpr, sub: ReadonlyMap<string, TypeExpr>): TypeExpr {
  switch (t.kind) {
    case "TypeRef":
      return sub.get(t.name) ?? t;
    case "TypeApp":
      return { ...t, args: t.args.map((a) => substituteType(a, sub)) };
    case "TypeRecord":
      return {
        ...t,
        fields: t.fields.map((f) => ({ name: f.name, type: substituteType(f.type, sub) })),
      };
    case "TypeUnion":
      return {
        ...t,
        variants: t.variants.map((v) => ({
          name: v.name,
          payloads: v.payloads.map((p) => substituteType(p, sub)),
        })),
      };
    case "TypeNominal":
    case "TypeRefinement":
      return { ...t, inner: substituteType(t.inner, sub) };
    default:
      return t;
  }
}

export function recordFieldType(
  rec: TypeExpr & { kind: "TypeRecord" },
  name: string,
): TypeExpr | null {
  return rec.fields.find((f) => f.name === name)?.type ?? null;
}

/** Look up a variant of a union by tag, after unaliasing. */
export function unionVariant(
  t: TypeExpr | null,
  tag: string,
  env: TypeEnv,
): { name: string; payloads: TypeExpr[] } | null {
  const u = unaliasType(t, env);
  if (u?.kind !== "TypeUnion") return null;
  return u.variants.find((v) => v.name === tag) ?? null;
}

/**
 * Numeric widening is the one implicit conversion in the language: an `Int`
 * flows into a `Float` position, never the reverse. Without it every `Float`
 * slot would have to be initialised `0.0`, and `slider(min=0)` on a `Float`
 * slot would be an error.
 */
const widensTo: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["Int", new Set(["Float"])],
]);

/**
 * Is a value of type `actual` accepted where `declared` is required?
 *
 * `true` also means "cannot tell". Callers must not read a `true` as proof the
 * program is well typed.
 */
export function assignable(
  actual: TypeExpr | null,
  declared: TypeExpr | null,
  env: TypeEnv,
): boolean {
  return relate(actual, declared, env, new Set());
}

function relate(
  actual: TypeExpr | null,
  declared: TypeExpr | null,
  env: TypeEnv,
  seen: ReadonlySet<string>,
): boolean {
  const a = unaliasType(actual, env);
  const d = unaliasType(declared, env);
  if (a === null || d === null) return true;
  // An unresolved name on either side (misspelling, type parameter) tells us
  // nothing, so it accepts and is accepted.
  if (a.kind === "TypeRef" || d.kind === "TypeRef") return true;

  switch (d.kind) {
    case "TypePrim":
      if (a.kind !== "TypePrim") return false;
      if (a.name === d.name) return true;
      return widensTo.get(a.name)?.has(d.name) ?? false;

    case "TypeApp": {
      if (a.kind !== "TypeApp" || a.name !== d.name) return false;
      // A constructor applied to the wrong number of arguments is E0210's
      // business; comparing the pairs we have keeps this from piling on.
      return d.args.every((darg, i) => {
        const aarg = a.args[i];
        return aarg === undefined || relate(aarg, darg, env, seen);
      });
    }

    case "TypeRecord": {
      if (a.kind !== "TypeRecord") return false;
      for (const f of d.fields) {
        const got = recordFieldType(a, f.name);
        if (got === null) return false;
        if (!relate(got, f.type, env, seen)) return false;
      }
      return a.fields.every((f) => recordFieldType(d, f.name) !== null);
    }

    case "TypeUnion": {
      if (a.kind !== "TypeUnion") return false;
      return a.variants.every((av) => {
        const dv = d.variants.find((v) => v.name === av.name);
        if (!dv || dv.payloads.length !== av.payloads.length) return false;
        return av.payloads.every((p, i) => relate(p, dv.payloads[i] ?? null, env, seen));
      });
    }

    default:
      return true;
  }
}

/**
 * Best-effort textual rendering of a type for diagnostic messages.
 *
 * The output is not only read by humans: `symbols.ts#variantTagsOf` parses the
 * type name back out of the E0209 message to offer variant suggestions, so
 * these shapes are a contract, not a formatting preference.
 */
export function typeToString(t: TypeExpr): string {
  switch (t.kind) {
    case "TypePrim":
      return t.name;
    case "TypeRef":
      return t.name;
    case "TypeApp":
      return t.args.length === 0 ? t.name : `${t.name}(${t.args.map(typeToString).join(", ")})`;
    case "TypeRecord":
      return `{${t.fields.map((f) => `${f.name}: ${typeToString(f.type)}`).join(", ")}}`;
    case "TypeUnion":
      return t.variants
        .map((v) =>
          v.payloads.length === 0
            ? v.name
            : `${v.name}(${v.payloads.map(typeToString).join(", ")})`,
        )
        .join(" | ");
    case "TypeNominal":
      return `nominal ${typeToString(t.inner)}`;
    case "TypeRefinement":
      return typeToString(t.inner);
  }
}

/** Arity of a type constructor, or `null` when it takes any number / is unknown. */
export function constructorArity(name: string, env: TypeEnv): number | null {
  const def = env.types.get(name);
  if (def) return def.params.length;
  return BUILTIN_TYPE_CONSTRUCTORS.get(name) ?? null;
}
