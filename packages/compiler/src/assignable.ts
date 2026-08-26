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
//
// `nominal` is the deliberate exception, and the only rule here that rejects a
// program the runtime would have run: `Cents := Yen` is two integers on the
// metal. What it reports is a mistake against the declaration rather than a
// value that would fail, which is the whole purpose of writing `nominal` —
// language.md §1.3.5. Every other rule keeps the reading above.

import type { Pos, TypeDef, TypeExpr } from "./ast.ts";
import { BUILTIN_TYPE_CONSTRUCTORS } from "./stdlib-types.ts";

/** The slice of the checker's symbol table the type relation needs. */
export type TypeEnv = { types: ReadonlyMap<string, TypeDef> };

/**
 * The type of an expression whose type could not be worked out. Spelled as a
 * `TypeRef` to a name the grammar cannot produce, so it takes the same
 * "unresolved name is opaque" path as a type parameter with no substitution —
 * one rule instead of a separate case in every comparison.
 *
 * `?` is also what a reader sees: nested inside a container it survives into
 * `typeToString`, and `Expected Int but got List(?)` is the honest rendering —
 * the value is a list, and its element type could not be decided. It cannot
 * appear on the declared side, which is the half `symbols.ts#variantTagsOf`
 * and `fix.ts` parse back out of a message.
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
 * parameter and a misspelling both become opaque. An alias that resolves to
 * itself returns `null` rather than looping: reporting the cycle is a separate
 * check, and normalisation has to terminate whether or not one exists.
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

/**
 * The name that makes a type nominal, or `null` when nothing does.
 *
 * Nominality belongs to the definition, not to the type expression: two
 * definitions with byte-identical bodies are still two types, and an alias to
 * one of them is the same type. So the answer is the name of the definition
 * whose body *is* a `nominal`, reached by following aliases and refinements —
 * `type Money = Cents` answers `Cents`, and `type P = Int where positive`
 * answers nothing, because a refinement on its own confers no identity.
 *
 * A `nominal` written inline at a use site (`slot x : nominal Int = 0`) has no
 * definition to name and so no identity; it is compared structurally.
 *
 * Deliberately independent of `unaliasType`, which strips `nominal` and must
 * keep doing so: method resolution, `elementType` and the arithmetic checks all
 * need to see the base.
 */
function nominalName(
  t: TypeExpr | null,
  env: TypeEnv,
  seen: ReadonlySet<string> = new Set(),
): string | null {
  if (!t) return null;
  if (t.kind === "TypeRefinement") return nominalName(t.inner, env, seen);
  if (t.kind !== "TypeRef" && t.kind !== "TypeApp") return null;
  if (seen.has(t.name)) return null;
  const def = env.types.get(t.name);
  if (!def) return null;
  if (def.body.kind === "TypeNominal") return t.name;
  return nominalName(def.body, env, new Set([...seen, t.name]));
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
        fields: t.fields.map((f) => ({ ...f, type: substituteType(f.type, sub) })),
      };
    case "TypeUnion":
      return {
        ...t,
        variants: t.variants.map((v) => ({
          ...v,
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

/**
 * What one iteration of `for x in <t>` binds, or `null` when the container's
 * element type is not decidable. `Map` is deliberately absent: what iterating a
 * Map yields is not settled anywhere in the spec, and a wrong answer here binds
 * the loop variable to a type it does not have.
 */
export function elementType(t: TypeExpr | null, env: TypeEnv): TypeExpr | null {
  const u = unaliasType(t, env);
  if (u?.kind !== "TypeApp") return null;
  if (u.name === "List" || u.name === "Set") return u.args[0] ?? null;
  return null;
}

/**
 * Numeric widening is the one implicit conversion in the language: an `Int`
 * flows into a `Float` position, never the reverse. Without it every `Float`
 * slot would have to be initialised `0.0`, and `slider(min=0)` on a `Float`
 * slot would be an error.
 */
const widensTo: ReadonlyMap<string, ReadonlySet<string>> = new Map([["Int", new Set(["Float"])]]);

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

/**
 * Comparisons already in progress, keyed by the pair being compared as written.
 *
 * `unaliasType`'s own guard covers one normalisation and nothing more: the
 * moment `relate` descends into a field or a payload it starts a fresh one, so
 * `type Node = {value: Int, next: Node}` recurses until the stack gives out.
 * A comment tree, a file tree and a nested todo are all this shape.
 *
 * Re-entering a pair means the answer depends on itself, and the only
 * terminating answer that keeps the relation one-sided is "yes" — refusing
 * would reject every recursive type. That is the standard co-inductive reading
 * of structural equality on regular trees, and it is sound here because the
 * finite part of the comparison has already been checked on the way down.
 */
function relate(
  actual: TypeExpr | null,
  declared: TypeExpr | null,
  env: TypeEnv,
  seen: ReadonlySet<string>,
): boolean {
  if (actual !== null && declared !== null) {
    // Keyed on the types *as written*, not on the unaliased forms: a recursive
    // type is finite as written (the cycle is a `TypeRef` back to its own
    // name), so the key set is finite and this terminates. Keying on the
    // expansion would not.
    const key = `${typeToString(actual)} ⇒ ${typeToString(declared)}`;
    if (seen.has(key)) return true;
    seen = new Set([...seen, key]);
  }
  // Asked before the wrappers come off, because taking them off is exactly what
  // loses the answer. Two names that both resolve to a `nominal` are two types
  // unless they are the same name; one nominal and its base still meet, which
  // is what lets `slot c : Cents = 1` and `c := c + 1` stand. Equal names fall
  // through rather than returning early, so `Box(Int)` and `Box(Text)` are
  // still told apart by their arguments.
  const an = nominalName(actual, env);
  const dn = nominalName(declared, env);
  if (an !== null && dn !== null && an !== dn) return false;
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

/** Does `name` name a type at all — a definition, or a built-in constructor? */
export function isKnownTypeName(name: string, env: TypeEnv): boolean {
  return env.types.has(name) || BUILTIN_TYPE_CONSTRUCTORS.has(name);
}

/**
 * How many type arguments `name` takes, or `null` when the question does not
 * apply — `Tuple` is variadic, and a name that is not a type has no arity.
 * Callers resolve the name with `isKnownTypeName` first, so by the time this
 * answers `null` the only reading left is "variadic".
 */
export function constructorArity(name: string, env: TypeEnv): number | null {
  const def = env.types.get(name);
  if (def) return def.params.length;
  return BUILTIN_TYPE_CONSTRUCTORS.get(name) ?? null;
}
